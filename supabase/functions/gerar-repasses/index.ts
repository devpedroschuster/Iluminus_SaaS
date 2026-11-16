// supabase/functions/gerar-repasses/index.ts
//
// Gera repasses para UMA mensalidade específica ao ser confirmada.
//
// Lógica por tipo de aula:
//   - regular / plano_livre → DELEGADO ao banco (ILU-122): a RPC
//                    `apurar_repasses_da_cobranca` calcula e grava as comissões
//                    por aluno × modalidade × mês de referência (competência).
//                    Esta função só chama a RPC e devolve itens/avisos.
//   - avulsa       → valor_pago × aula_avulsa_pct_prof para o professor vinculado
//   - experimental → valor_pago × aula_experimental_pct_prof se pct_prof > 0, caso contrário sem repasse.
//                    Única regra que também vale para visitante sem aluno cadastrado (pagamento
//                    automático do agendamento da experimental — RPC agendar_aula_experimental).
//                    Avulsa/experimental NUNCA preenchem `competencia`.
//
// Chamada via: supabase.functions.invoke('gerar-repasses', { body: { mensalidadeId } })
// Também é chamada pela etapa de reconciliação do lote mensal (gerar-repasses-mensais,
// etapa final) para cobrir avulsas/experimentais cujo repasse não foi gerado no momento
// original do pagamento.
//
// AUDITORIA 2026-07 — FIX-01/FIX-02: todo `error` de query é checado e propagado
// (throw); o delete de repasses anteriores verifica erro antes de inserir.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { avisoDaLinha, type LinhaApuracao } from '../_shared/repasses.ts';

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

// REP-01: interface expandida com campos de avulsa e experimental
interface ConfigRepasse {
  valor_1_modalidade: number;
  valor_multi_modalidade: number;
  plano_livre_pct_casa: number;
  plano_livre_pct_prof: number;
  aula_avulsa_valor: number;
  aula_avulsa_pct_prof: number;
  aula_avulsa_pct_casa: number;
  aula_experimental_valor: number;
  aula_experimental_pct_prof: number;
}

interface Mensalidade {
  id: string;
  aluno_id: string | null;
  plano_id: string | null;
  tipo_aula: string;
  valor_pago: number;
  professor_id: string | null;
  modalidade_nome: string | null;
  data_pagamento: string | null;
  data_vencimento: string;
  modalidade_id: string | null;
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
    // Sem isso, qualquer aluno/professor autenticado podia reescrever
    // lançamentos de comissão de qualquer mensalidade. Só admin pode chamar —
    // exceto a própria plataforma chamando com a service role key, usada pela
    // reconciliação de avulsas/experimentais em gerar-repasses-mensais (passo 11).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return response({ error: 'Não autenticado: token ausente' }, 401);
    }

    const isServiceRole = authHeader === `Bearer ${supabaseKey}`;
    if (!isServiceRole) {
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
        console.error('[gerar-repasses] erro ao checar perfil:', perfilErr.message);
        return response({ error: 'Erro ao validar permissões' }, 500);
      }

      if (solicitante?.role !== 'admin') {
        return response({ error: 'Acesso negado: apenas administradores podem executar esta ação' }, 403);
      }
    }

    const { mensalidadeId } = await req.json();

    if (!mensalidadeId) {
      return response({ error: 'Parâmetro mensalidadeId é obrigatório.' }, 400);
    }

    // ── 1. Busca a mensalidade ──────────────────────────────────────────────
    const { data: mens, error: errMens } = await supabase
      .from('mensalidades')
      .select('id, aluno_id, plano_id, tipo_aula, valor_pago, professor_id, modalidade_nome, modalidade_id, data_pagamento, data_vencimento')
      .eq('id', mensalidadeId)
      .single();

    if (errMens || !mens) {
      return response({ error: 'Mensalidade não encontrada.' }, 404);
    }

    const mensalidade = mens as Mensalidade;

    // Visitante sem aluno vinculado não gera repasse — exceto aula
    // experimental: quem agenda a experimental quase nunca tem cadastro
    // ainda, e o professor recebe pela aula dada (aula_experimental_pct_prof).
    if (!mensalidade.aluno_id && mensalidade.tipo_aula !== 'experimental') {
      return response({ aviso: 'Mensalidade sem aluno vinculado. Nenhum repasse gerado.', gerados: 0 });
    }

    // ── 2. REGULAR / PLANO LIVRE: delegado ao banco (ILU-122) ───────────────
    // A RPC calcula e grava as comissões por aluno × modalidade × mês de
    // referência. Devolve também as linhas que NÃO geraram comissão (com a
    // situação), que viram `avisos`. `valor` (numeric) chega como string.
    if (mensalidade.tipo_aula === 'regular' || mensalidade.tipo_aula === 'plano_livre') {
      const { data: linhasRpc, error: errRpc } = await supabase.rpc('apurar_repasses_da_cobranca', {
        p_mensalidade_id: mensalidadeId,
      });
      if (errRpc) throw errRpc;

      const linhas = (linhasRpc ?? []) as LinhaApuracao[];
      if (linhas.length === 0) {
        return response({
          aviso: 'Nenhum repasse calculado para esta cobrança.',
          gerados: 0,
          itens: [],
          avisos: [],
        });
      }

      const geradas = linhas.filter((l) => l.situacao === 'gerada');
      return response({
        sucesso: true,
        gerados: geradas.length,
        itens: geradas.map((l) => ({
          modalidade: l.modalidade,
          valor: Number(l.valor),
          tipo: l.tipo_aula,
          competencia: l.competencia,
        })),
        avisos: linhas.map(avisoDaLinha).filter((a): a is string => a !== null),
      });
    }

    if (mensalidade.tipo_aula !== 'avulsa' && mensalidade.tipo_aula !== 'experimental') {
      return response({ aviso: 'Nenhum repasse calculado para este tipo de aula.', gerados: 0 });
    }

    // ── 3. AVULSA / EXPERIMENTAL ────────────────────────────────────────────
    // REP-01: select expandido com campos de avulsa e experimental
    const { data: config, error: errConfig } = await supabase
      .from('configuracoes_repasse')
      .select('valor_1_modalidade, valor_multi_modalidade, plano_livre_pct_casa, plano_livre_pct_prof, aula_avulsa_valor, aula_avulsa_pct_prof, aula_avulsa_pct_casa, aula_experimental_valor, aula_experimental_pct_prof')
      .single();

    if (errConfig || !config) throw new Error('Configurações de repasse não encontradas.');
    const cfg = config as ConfigRepasse;

    // Idempotência: remove repasses anteriores desta mensalidade.
    // FIX-02: erro é checado — se a limpeza falhar, abortamos em vez de
    // seguir e potencialmente inserir itens duplicados ao lado dos antigos.
    const { error: errDeleteAnterior } = await supabase
      .from('repasses_lancamentos')
      .delete()
      .eq('mensalidade_id', mensalidadeId);

    if (errDeleteAnterior) throw errDeleteAnterior;

    // Data de referência = primeiro dia do mês do pagamento
    const dataBase = mensalidade.data_pagamento || mensalidade.data_vencimento;
    const [anoRef, mesRef] = dataBase.substring(0, 7).split('-').map(Number);
    const mesStr = String(mesRef).padStart(2, '0');
    const dataReferencia = `${anoRef}-${mesStr}-01`;

    const itens: {
      professor_id: string;
      aluno_id: string | null;
      mensalidade_id: string;
      tipo_aula: string;
      modalidade: string;
      valor: number;
      data_referencia: string;
    }[] = [];

    if (mensalidade.tipo_aula === 'avulsa') {
      if (!mensalidade.professor_id) {
        return response({ aviso: 'Aula avulsa sem professor. Repasse não gerado.', gerados: 0 });
      }

      const valorRepasse = Math.round(Number(mensalidade.valor_pago) * (cfg.aula_avulsa_pct_prof / 100) * 100) / 100;

      itens.push({
        professor_id: mensalidade.professor_id,
        aluno_id: mensalidade.aluno_id!,
        mensalidade_id: mensalidadeId,
        tipo_aula: 'avulsa',
        modalidade: mensalidade.modalidade_nome ?? 'Avulsa',
        valor: valorRepasse,
        data_referencia: dataReferencia,
      });

    // ── EXPERIMENTAL ────────────────────────────────────────────────────
    // Gera repasse apenas se aula_experimental_pct_prof > 0 nas configurações.
    // Se o percentual for 0, a experimental não remunera o professor — sem repasse.
    } else if (mensalidade.tipo_aula === 'experimental') {
      const pctProf = Number(cfg.aula_experimental_pct_prof);

      if (pctProf <= 0) {
        return response({ aviso: 'Aula experimental com percentual 0. Nenhum repasse gerado.', gerados: 0 });
      }

      if (!mensalidade.professor_id) {
        return response({ aviso: 'Aula experimental sem professor vinculado. Repasse não gerado.', gerados: 0 });
      }

      const valorRepasse = Math.round(Number(mensalidade.valor_pago) * (pctProf / 100) * 100) / 100;

      itens.push({
        professor_id: mensalidade.professor_id,
        aluno_id: mensalidade.aluno_id,
        mensalidade_id: mensalidadeId,
        tipo_aula: 'experimental',
        modalidade: mensalidade.modalidade_nome ?? 'Experimental',
        valor: valorRepasse,
        data_referencia: dataReferencia,
      });
    }

    // ── 5. Insere ───────────────────────────────────────────────────────────
    if (itens.length === 0) {
      return response({ aviso: 'Nenhum repasse calculado para este tipo de aula.', gerados: 0 });
    }

    const { error: errInsert } = await supabase
      .from('repasses_lancamentos')
      .insert(itens);

    if (errInsert) throw errInsert;

    return response({
      sucesso: true,
      gerados: itens.length,
      itens: itens.map(i => ({ modalidade: i.modalidade, valor: i.valor, tipo: i.tipo_aula })),
    });

  } catch (err) {
    const message =
      err instanceof Error ? err.message
      : typeof err === 'object' && err !== null ? JSON.stringify(err)
      : String(err);
    console.error('[gerar-repasses] ERRO:', message);
    return response({ error: message }, 500);
  }
});