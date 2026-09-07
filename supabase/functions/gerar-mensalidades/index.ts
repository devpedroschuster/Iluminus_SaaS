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
//
// AUDITORIA 2026-09 — Correção aplicada:
//   FIX-05 (ILU-50): function rodava com verify_jwt=false e sem nenhuma
//           checagem no código — qualquer pessoa na internet, sem estar
//           autenticada, podia disparar a geração de mensalidades do mês
//           antes da data programada. Agora exige o mesmo segredo
//           compartilhado usado nas demais functions cron-only (ILU-10).

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  // ── AUTORIZAÇÃO (ILU-50) ────────────────────────────────────────────────
  // Função só deve rodar via cron, nunca por chamada direta/anônima (dispara
  // cobrança do mês para todos os alunos ativos e notifica admins). Exige um
  // segredo compartilhado que só o job de cron conhece, configurado como
  // header `x-cron-secret` (mesmo padrão de gerar-presencas-diario,
  // processar-notificacoes e lembretes-aula — ILU-10).
  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return response({ error: 'Não autorizado' }, 401)
  }

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
    // BUG CRÍTICO CORRIGIDO: a tabela `alunos` não tem coluna `status` (só o
    // booleano `ativo`). O filtro `.eq('status', 'ativo')` fazia essa query
    // falhar com 400 (coluna inexistente) em toda execução da function,
    // quebrando a geração automática de mensalidades por completo.
    // O client sem tipos gerados do schema infere `planos` como array (não
    // consegue ver que alunos.plano_id -> planos.id é many-to-one); em
    // runtime o PostgREST sempre devolve um objeto único aqui, nunca array.
    type AlunoComPlano = {
      id: string
      nome_completo: string
      plano_id: string
      bolsista: boolean
      planos: { id: string; preco: number | string | null } | null
    }

    const { data: alunosRaw, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, nome_completo, plano_id, bolsista, planos(id, preco)')
      .eq('ativo', true)
      .not('plano_id', 'is', null) // ignora alunos sem plano

    if (errAlunos) throw errAlunos
    const alunos = alunosRaw as unknown as AlunoComPlano[] | null
    if (!alunos || alunos.length === 0) {
      return response({ message: 'Nenhum aluno ativo com plano.' })
    }

    // ILU-11: bolsista não é cobrado, independente do plano vinculado —
    // não gera mensalidade nenhuma para ele (em vez de gerar com valor e
    // depender de alguém zerar manualmente todo mês).
    const alunosBolsistas: string[] = []
    const alunosNaoBolsistas = alunos.filter(a => {
      if (a.bolsista) {
        alunosBolsistas.push(a.nome_completo)
        return false
      }
      return true
    })

    // 2. Filtra plano "DEFINIR PLANO" (preco = 0 ou nulo) — não gera cobrança
    const alunosSemPreco: string[] = []
    const alunosValidos = alunosNaoBolsistas.filter(a => {
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
        ignoradosBolsistas: alunosBolsistas,
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

    // 6. Notifica admins sobre a geração
    // AUDITORIA 2026-09 (ILU-7): esta etapa consultava `.from('profiles')` e
    // inseria em `.from('notificacoes')` — NENHUMA das duas tabelas existe no
    // banco (a tabela real de perfis é `perfis`; não existe `notificacoes`, só
    // `notificacoes_pendentes`, que é uma fila de push exclusiva para
    // professores — exige `professor_id` NOT NULL e é consumida por
    // `processar-notificacoes` com mensagens fixas por `tipo`, não serve para
    // um aviso genérico de admin). Toda execução falhava 100% das vezes nas
    // duas queries, e o erro era só logado — a notificação nunca funcionou e
    // ninguém percebia. Criar uma tabela de notificação para admins é uma
    // decisão de produto fora do escopo deste fix; até lá, reportamos isso de
    // forma explícita na resposta em vez de tentar (e falhar) silenciosamente.
    const avisos: string[] = []
    if (geradas > 0) {
      avisos.push(
        'Notificação de admin sobre cobranças geradas não foi enviada: não existe hoje uma tabela de notificação para admins no banco.'
      )
    }

    return response({
      sucesso: true,
      geradas,
      mes: mesLabel,
      data_vencimento,
      ignoradosSemPreco: alunosSemPreco,
      ignoradosBolsistas: alunosBolsistas,
      avisos,
    })

  } catch (err) {
    console.error('[gerar-mensalidades] ERRO:', err instanceof Error ? err.message : err)
    return response({ erro: err instanceof Error ? err.message : String(err) }, 500)
  }
})