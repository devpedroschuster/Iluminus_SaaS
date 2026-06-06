// supabase/functions/gerar-repasses/index.ts
//
// Gera repasses para UMA mensalidade específica ao ser confirmada.
//
// Lógica por tipo de aula:
//   - regular    → valor fixo por modalidade matriculada (cfg.valor_1_modalidade ou valor_multi)
//   - plano_livre → valor_pago × pct_prof, dividido igualmente entre modalidades frequentadas no mês.
//                   Se nenhuma presença → sem repasse (100% fica para o espaço).
//   - avulsa     → cfg.valor_1_modalidade para o professor vinculado
//   - experimental → sem repasse
//
// Chamada via: supabase.functions.invoke('gerar-repasses', { body: { mensalidadeId } })

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

interface ConfigRepasse {
  valor_1_modalidade: number;
  valor_multi_modalidade: number;
  plano_livre_pct_casa: number;
  plano_livre_pct_prof: number;
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
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { mensalidadeId } = await req.json();

    if (!mensalidadeId) {
      return response({ error: 'Parâmetro mensalidadeId é obrigatório.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 1. Busca a mensalidade ──────────────────────────────────────────────
    const { data: mens, error: errMens } = await supabase
      .from('mensalidades')
      .select('id, aluno_id, plano_id, tipo_aula, valor_pago, professor_id, modalidade_nome, data_pagamento, data_vencimento')
      .eq('id', mensalidadeId)
      .single();

    if (errMens || !mens) {
      return response({ error: 'Mensalidade não encontrada.' }, 404);
    }

    const mensalidade = mens as Mensalidade;

    // Visitante ou experimental não geram repasse
    if (!mensalidade.aluno_id) {
      return response({ aviso: 'Mensalidade sem aluno vinculado. Nenhum repasse gerado.', gerados: 0 });
    }
    if (mensalidade.tipo_aula === 'experimental') {
      return response({ aviso: 'Aula experimental não gera repasse.', gerados: 0 });
    }

    // ── 2. Configurações de repasse ─────────────────────────────────────────
    const { data: config, error: errConfig } = await supabase
      .from('configuracoes_repasse')
      .select('valor_1_modalidade, valor_multi_modalidade, plano_livre_pct_casa, plano_livre_pct_prof')
      .single();

    if (errConfig || !config) throw new Error('Configurações de repasse não encontradas.');
    const cfg = config as ConfigRepasse;

    // ── 3. Idempotência: remove repasses anteriores desta mensalidade ───────
    await supabase
      .from('repasses_lancamentos')
      .delete()
      .eq('mensalidade_id', mensalidadeId);

    // Data de referência = primeiro dia do mês do pagamento
    const dataBase = mensalidade.data_pagamento || mensalidade.data_vencimento;
    const [anoRef, mesRef] = dataBase.substring(0, 7).split('-').map(Number);
    const mesStr = String(mesRef).padStart(2, '0');
    const dataReferencia = `${anoRef}-${mesStr}-01`;
    const ultimoDia = new Date(anoRef, mesRef, 0).getDate();
    const inicioPeriodo = dataReferencia;
    const fimPeriodo = `${anoRef}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

    const itens: {
      professor_id: string;
      aluno_id: string;
      mensalidade_id: string;
      tipo_aula: string;
      modalidade: string;
      valor: number;
      data_referencia: string;
    }[] = [];

    // ── 4a. PLANO LIVRE ─────────────────────────────────────────────────────
    if (mensalidade.tipo_aula === 'plano_livre') {

      // Busca presenças do aluno no mês via join agenda → modalidades
      const { data: presencas, error: errPresencas } = await supabase
        .from('presencas')
        .select(`
          aula_id,
          agenda (
            modalidades (
              id,
              nome,
              professor_id
            )
          )
        `)
        .eq('aluno_id', mensalidade.aluno_id)
        .gte('data_checkin', `${inicioPeriodo}T00:00:00`)
        .lte('data_checkin', `${fimPeriodo}T23:59:59`)
        .not('aula_id', 'is', null);

      if (errPresencas) throw errPresencas;

      if (!presencas || presencas.length === 0) {
        // Sem presenças → sem repasse para professores (100% fica para o espaço)
        return response({
          aviso: 'Plano livre sem presenças no mês. Nenhum repasse gerado para professores.',
          gerados: 0,
        });
      }

      // Deduplica modalidades frequentadas (uma por professor)
      const modMap = new Map<string, { nome: string; professor_id: string }>();
      for (const p of presencas) {
        const mod = (p.agenda as any)?.modalidades;
        if (mod?.id && mod?.professor_id) {
          modMap.set(mod.id, { nome: mod.nome, professor_id: mod.professor_id });
        }
      }

      if (modMap.size === 0) {
        return response({
          aviso: 'Plano livre: presenças encontradas mas nenhuma modalidade com professor vinculado.',
          gerados: 0,
        });
      }

      // Cálculo: valor_pago × pct_prof ÷ nº de modalidades frequentadas
      const valorTotal = Number(mensalidade.valor_pago);
      const pctProf = Number(cfg.plano_livre_pct_prof) / 100;
      const parteProfs = valorTotal * pctProf;
      const valorPorMod = Math.round((parteProfs / modMap.size) * 100) / 100;

      for (const [, mod] of modMap) {
        itens.push({
          professor_id: mod.professor_id,
          aluno_id: mensalidade.aluno_id!,
          mensalidade_id: mensalidadeId,
          tipo_aula: 'plano_livre',
          modalidade: mod.nome,
          valor: valorPorMod,
          data_referencia: dataReferencia,
        });
      }

    // ── 4b. REGULAR ─────────────────────────────────────────────────────────
    } else if (mensalidade.tipo_aula === 'regular') {
      const { data: aluno } = await supabase
        .from('alunos')
        .select('modalidades_selecionadas')
        .eq('id', mensalidade.aluno_id)
        .single();

      const modIds: string[] = aluno?.modalidades_selecionadas ?? [];

      if (modIds.length === 0) {
        return response({ aviso: 'Aluno sem modalidades vinculadas. Repasse não gerado.', gerados: 0 });
      }

      const { data: mods } = await supabase
        .from('modalidades')
        .select('id, nome, professor_id')
        .in('id', modIds)
        .not('professor_id', 'is', null);

      const modsValidas = (mods ?? []) as { id: string; nome: string; professor_id: string }[];

      if (modsValidas.length === 0) {
        return response({ aviso: 'Modalidades sem professor vinculado. Repasse não gerado.', gerados: 0 });
      }

      const valorPorMod = modsValidas.length === 1
        ? Number(cfg.valor_1_modalidade)
        : Number(cfg.valor_multi_modalidade);

      for (const mod of modsValidas) {
        itens.push({
          professor_id: mod.professor_id,
          aluno_id: mensalidade.aluno_id!,
          mensalidade_id: mensalidadeId,
          tipo_aula: 'regular',
          modalidade: mod.nome,
          valor: valorPorMod,
          data_referencia: dataReferencia,
        });
      }

    // ── 4c. AVULSA ──────────────────────────────────────────────────────────
    } else if (mensalidade.tipo_aula === 'avulsa') {
      if (!mensalidade.professor_id) {
        return response({ aviso: 'Aula avulsa sem professor vinculado. Repasse não gerado.', gerados: 0 });
      }

      itens.push({
        professor_id: mensalidade.professor_id,
        aluno_id: mensalidade.aluno_id!,
        mensalidade_id: mensalidadeId,
        tipo_aula: 'avulsa',
        modalidade: mensalidade.modalidade_nome ?? 'Avulsa',
        valor: Number(cfg.valor_1_modalidade),
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