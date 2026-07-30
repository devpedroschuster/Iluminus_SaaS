// supabase/functions/gerar-mensalidades/index.ts
//
// Gera mensalidades mensais para alunos ativos com plano.
//
// AUDITORIA 2026-07 — Correções aplicadas:
//   FIX-01: `data_vencimento` do mês agora é calculada com o ÚLTIMO DIA REAL
//           do mês (via `new Date(ano, mes, 0)`), eliminando o literal
//           "YYYY-MM-31" que quebrava (erro de cast para `date`) em meses
//           com menos de 31 dias — fevereiro, abril, junho, setembro,
//           novembro. Antes, esse erro era descartado silenciosamente e
//           esvaziava a proteção contra duplicidade para TODOS os alunos.
//   FIX-02: todo `error` de query agora é checado e propagado (throw).
//   FIX-03: inserção agora é `upsert` com `ignoreDuplicates: true` sobre uma
//           constraint única `(aluno_id, plano_id, data_vencimento)` (ver
//           migration complementar), tornando a geração idempotente mesmo
//           que a function seja chamada duas vezes (cron duplicado, clique
//           manual concorrente, retry de rede) — a segunda chamada não
//           insere linhas repetidas, independente de qualquer falha na
//           checagem prévia.
//   FIX-04: dedupe agora considera (aluno_id, plano_id), não só aluno_id —
//           caso o modelo de dados evolua para permitir múltiplos planos
//           simultâneos por aluno, a checagem continua correta por plano.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth() + 1
  const mesStr = String(mes).padStart(2, '0')
  const mesLabel = hoje.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })

  // FIX-01: último dia real do mês, nunca um literal fixo "-31".
  // new Date(ano, mes, 0) retorna o último dia do mês `mes` (1-indexado),
  // porque o dia 0 do mês seguinte é o último dia do mês atual.
  const ultimoDiaDoMes = new Date(ano, mes, 0).getDate()
  const inicioMes = `${ano}-${mesStr}-01`
  const fimMes = `${ano}-${mesStr}-${String(ultimoDiaDoMes).padStart(2, '0')}`

  // Dia 10 como vencimento padrão
  const data_vencimento = `${ano}-${mesStr}-10`

  try {
    // 1. Busca alunos ativos com plano (join em planos para pegar o preco)
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, nome_completo, plano_id, planos(id, preco)')
      .eq('status', 'ativo')
      .not('plano_id', 'is', null) // ignora alunos sem plano

    if (errAlunos) throw errAlunos
    if (!alunos || alunos.length === 0) {
      return response({ message: 'Nenhum aluno ativo com plano.' })
    }

    // 2. Filtra plano "DEFINIR PLANO" (preco = 0 ou nulo) — não gera cobrança
    const alunosSemPreco: string[] = []
    const alunosValidos = alunos.filter(a => {
      const preco = Number(a.planos?.preco)
      const valido = Number.isFinite(preco) && preco > 0
      if (!valido) alunosSemPreco.push(a.nome_completo)
      return valido
    })

    // 3. Verifica duplicatas: (aluno_id, plano_id) que já têm mensalidade
    //    neste mês. FIX-04: inclui plano_id na chave de dedupe.
    // FIX-02: erro agora é checado.
    const { data: jaGeradas, error: errJaGeradas } = await supabase
      .from('mensalidades')
      .select('aluno_id, plano_id')
      .gte('data_vencimento', inicioMes)
      .lte('data_vencimento', fimMes)

    if (errJaGeradas) throw errJaGeradas

    const comMensalidade = new Set(
      (jaGeradas || []).map(m => `${m.aluno_id}|${m.plano_id}`)
    )

    // 4. Filtra só quem ainda não tem mensalidade deste plano neste mês
    const paraGerar = alunosValidos.filter(
      a => !comMensalidade.has(`${a.id}|${a.plano_id}`)
    )

    if (paraGerar.length === 0) {
      return response({
        message: 'Mensalidades já geradas para todos os alunos ativos.',
        ignoradosSemPreco: alunosSemPreco,
      })
    }

    // 5. Monta inserção com os campos reais da sua tabela
    const mensalidades = paraGerar.map(aluno => ({
      aluno_id: aluno.id,
      plano_id: aluno.plano_id,
      data_vencimento,
      status: 'pendente',
      tipo_aula: 'regular',
      valor_pago: aluno.planos?.preco ?? '0.00',
      desconto_aplicado: 0,
      multa_aplicada: 0,
      juros_aplicados: 0,
    }))

    // FIX-03: upsert idempotente — requer constraint única
    //   (aluno_id, plano_id, data_vencimento)
    // na tabela `mensalidades` (ver migration complementar). Isso garante
    // que, mesmo que esta function seja chamada duas vezes no mesmo mês
    // (cron duplicado, clique manual concorrente), a segunda chamada não
    // insere linhas repetidas.
    const { data: inseridas, error: errInsert } = await supabase
      .from('mensalidades')
      .upsert(mensalidades, {
        onConflict: 'aluno_id,plano_id,data_vencimento',
        ignoreDuplicates: true,
      })
      .select('id')

    if (errInsert) throw errInsert

    const geradas = inseridas?.length ?? 0

    // 6. Notifica admins via tabela notificacoes
    const { data: admins, error: errAdmins } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin')

    if (errAdmins) {
      console.error('[gerar-mensalidades] Falha ao buscar admins para notificação:', errAdmins.message)
    } else if (admins && admins.length > 0 && geradas > 0) {
      const { error: errNotif } = await supabase.from('notificacoes').insert(
        admins.map(admin => ({
          user_id: admin.id,
          tipo: 'cobranca',
          titulo: '💰 Cobranças geradas',
          mensagem: `${geradas} mensalidade(s) gerada(s) para ${mesLabel}.`,
          lida: false,
        }))
      )
      if (errNotif) {
        console.error('[gerar-mensalidades] Falha ao criar notificações:', errNotif.message)
      }
    }

    return response({
      sucesso: true,
      geradas,
      mes: mesLabel,
      data_vencimento,
      ignoradosSemPreco: alunosSemPreco,
    })

  } catch (err) {
    console.error('[gerar-mensalidades] ERRO:', err instanceof Error ? err.message : err)
    return response({ erro: err instanceof Error ? err.message : String(err) }, 500)
  }
})