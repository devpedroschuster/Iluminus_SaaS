// supabase/functions/gerar-repasses-mensais/index.ts
//
// Gera os repasses de um mês de referência para todos os professores.
//
// ILU-122: o cálculo de regular / plano livre foi para o banco. Esta função
// chama `rpc('apurar_repasses', { p_competencia, p_simular: false })`, que
// apura aluno × modalidade × mês (cobertura por pagamento, pausa, bolsa, plano
// livre pelo mês fechado etc.) e já GRAVA as comissões `gerada`. Aqui só se
// resume o resultado por professor e se montam os avisos.
//
// NOTA ARQUITETURAL — Avulsa e Experimental:
//   Aulas avulsas e experimentais são cobranças pontuais sem vínculo de matrícula.
//   Os respectivos repasses são gerados no momento do pagamento via `gerar-repasses`
//   (com mensalidade_id preenchido). Na etapa de RECONCILIAÇÃO (final), varre
//   mensalidades pagas do tipo avulsa/experimental no mês que NÃO possuem
//   repasse correspondente (falha de rede, timeout etc. no momento do pagamento)
//   e chama `gerar-repasses` para cada uma.
//
// `jaGerados` na resposta é informativo: indica que alguma comissão do mês já
// existia (situacao `ja_existia`); a proteção contra duplicidade é do banco.
//
// Chamada manual via: supabase.functions.invoke('gerar-repasses-mensais', { body: { mes, ano } })

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { avisoDaLinha, resumirPorProfessor, type LinhaApuracao } from '../_shared/repasses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── AUTORIZAÇÃO (ILU-10) ─────────────────────────────────────────────────
    // Sem isso, qualquer aluno/professor autenticado disparava a geração em
    // lote de comissões do mês inteiro para qualquer { mes, ano }. Só admin.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return response({ error: 'Não autenticado: token ausente' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return response({ error: 'Não autenticado: token inválido' }, 401);
    }

    const { data: solicitante, error: perfilErr } = await supabase
      .from('alunos')
      .select('role')
      .eq('auth_id', userData.user.id)
      .maybeSingle();

    if (perfilErr) {
      console.error('[gerar-repasses-mensais] erro ao checar perfil:', perfilErr.message);
      return response({ error: 'Erro ao validar permissões' }, 500);
    }

    if (solicitante?.role !== 'admin') {
      return response({ error: 'Acesso negado: apenas administradores podem executar esta ação' }, 403);
    }

    const { mes, ano } = await req.json();

    if (!mes || !ano || mes < 1 || mes > 12) {
      return response({ error: 'Parâmetros inválidos. Informe mes (1–12) e ano.' }, 400);
    }

    const mesStr = String(mes).padStart(2, '0');
    const dataReferencia = `${ano}-${mesStr}-01`;

    // Período completo do mês (usado na reconciliação de avulsas/experimentais)
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const inicioPeriodo = `${ano}-${mesStr}-01`;
    const fimPeriodo = `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

    // ── 1. Apuração no banco (regular + plano livre) ────────────────────────
    // A RPC grava as `gerada` e devolve todas as linhas (inclusive as que não
    // geraram comissão, com a situação). Erros de negócio (mês futuro, mês
    // anterior ao corte) voltam como mensagem do Postgres.
    const { data: linhasRpc, error: errRpc } = await supabase.rpc('apurar_repasses', {
      p_competencia: dataReferencia,
      p_simular: false,
    });
    if (errRpc) {
      return response({ error: errRpc.message }, 500);
    }

    const linhas = (linhasRpc ?? []) as LinhaApuracao[];
    const geradas = linhas.filter((l) => l.situacao === 'gerada');
    const loteJaGeradoAntes = linhas.some((l) => l.situacao === 'ja_existia');
    const avisos: string[] = linhas
      .map(avisoDaLinha)
      .filter((a): a is string => a !== null);

    // ── 2. Resumo por professor (apenas das comissões geradas agora) ────────
    const { data: profsRaw, error: errProfs } = await supabase
      .from('professores')
      .select('id, nome');
    if (errProfs) throw errProfs;

    const nomes = new Map<string, string>();
    for (const p of (profsRaw ?? []) as { id: string; nome: string }[]) nomes.set(p.id, p.nome);

    // Mantém os campos que a tela de Comissões lê: nome, total, alunos.
    const resumo = resumirPorProfessor(linhas, nomes).map((r) => ({
      nome: r.nome,
      total: r.total,
      alunos: r.qtdLancamentos,
    }));

    // ── 11. Reconciliação: avulsas/experimentais pagas no mês sem repasse ───
    // FIX-04: cobre o caso em que `gerar-repasses` não rodou (ou falhou) no
    // momento da confirmação do pagamento de uma aula avulsa/experimental.
    // Sem esta etapa, essas comissões nunca seriam recalculadas, porque o
    // restante deste arquivo ignora avulsa/experimental por design.
    let avulsasReconciliadas = 0;
    const { data: mensalidadesAvulsas, error: errMensAvulsas } = await supabase
      .from('mensalidades')
      .select('id')
      .in('tipo_aula', ['avulsa', 'experimental'])
      .gte('data_pagamento', inicioPeriodo)
      .lte('data_pagamento', fimPeriodo)
      .not('data_pagamento', 'is', null);

    if (errMensAvulsas) {
      avisos.push('Não foi possível checar reconciliação de aulas avulsas/experimentais neste mês.');
    } else {
      const idsAvulsas = (mensalidadesAvulsas ?? []).map((m) => m.id as string);

      if (idsAvulsas.length > 0) {
        const { data: jaTemRepasse, error: errJaTem } = await supabase
          .from('repasses_lancamentos')
          .select('mensalidade_id')
          .in('mensalidade_id', idsAvulsas);

        if (errJaTem) {
          avisos.push('Não foi possível checar reconciliação de aulas avulsas/experimentais neste mês.');
        } else {
          const idsComRepasse = new Set((jaTemRepasse ?? []).map((r) => r.mensalidade_id as string));
          const idsFaltantes = idsAvulsas.filter((id) => !idsComRepasse.has(id));

          for (const mensalidadeId of idsFaltantes) {
            const { error: errGerar } = await supabase.functions.invoke('gerar-repasses', {
              body: { mensalidadeId },
            });
            if (!errGerar) {
              avulsasReconciliadas++;
            } else {
              avisos.push(`Falha ao reconciliar repasse da mensalidade ${mensalidadeId} (avulsa/experimental).`);
            }
          }
        }
      }
    }

    if (geradas.length === 0 && avulsasReconciliadas === 0) {
      return response({
        aviso: loteJaGeradoAntes
          ? `Repasses de ${mesStr}/${ano} já estavam completos — nenhum lançamento novo encontrado.`
          : 'Nenhum repasse calculado. Verifique se as modalidades têm professores vinculados.',
        gerados: 0,
        jaGerados: loteJaGeradoAntes,
        avisos,
      });
    }

    return response({
      sucesso: true,
      mes: `${mesStr}/${ano}`,
      gerados: geradas.length,
      jaGerados: loteJaGeradoAntes,
      avulsasReconciliadas,
      resumo,
      avisos,
    });

  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err);
    console.error('[gerar-repasses-mensais] ERRO:', message);
    return response({ error: message }, 500);
  }
});