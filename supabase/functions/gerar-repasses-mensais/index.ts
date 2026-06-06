// supabase/functions/gerar-repasses-mensais/index.ts
//
// Gera repasses para todos os professores com base nos alunos
// MATRICULADOS nas suas modalidades — independente de pagamento.
//
// Chamada manual via: supabase.functions.invoke('gerar-repasses-mensais', { body: { mes, ano } })

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

interface Modalidade {
  id: string;
  nome: string;
  professor_id: string;
}

interface Professor {
  id: string;
  nome: string;
}

interface Aluno {
  id: string;
  nome_completo: string;
  modalidades_selecionadas: string[];
}

interface ResumoProf {
  nome: string;
  total: number;
  alunos: number;
}

interface ConfigRepasse {
  valor_1_modalidade: number;
  valor_multi_modalidade: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { mes, ano } = await req.json();

    if (!mes || !ano || mes < 1 || mes > 12) {
      return response({ error: 'Parâmetros inválidos. Informe mes (1–12) e ano.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const mesStr = String(mes).padStart(2, '0');
    const dataReferencia = `${ano}-${mesStr}-01`;

    // ── 1. Previne dupla geração no mesmo mês ───────────────────────────────
    const { data: jaExistem } = await supabase
      .from('repasses_lancamentos')
      .select('id')
      .eq('data_referencia', dataReferencia)
      .limit(1);

    if (jaExistem && jaExistem.length > 0) {
      return response({
        error: `Repasses de ${mesStr}/${ano} já foram gerados. Exclua-os antes de regerar.`,
        jaGerados: true,
      }, 409);
    }

    // ── 2. Configurações de repasse ─────────────────────────────────────────
    const { data: config, error: errConfig } = await supabase
      .from('configuracoes_repasse')
      .select('valor_1_modalidade, valor_multi_modalidade')
      .single();

    if (errConfig || !config) throw new Error('Configurações de repasse não encontradas.');
    const cfg = config as ConfigRepasse;

    // ── 3. Modalidades com professor vinculado ──────────────────────────────
    const { data: modsRaw, error: errMods } = await supabase
      .from('modalidades')
      .select('id, nome, professor_id')
      .not('professor_id', 'is', null);

    if (errMods) throw errMods;
    if (!modsRaw || modsRaw.length === 0) {
      return response({ aviso: 'Nenhuma modalidade com professor vinculado.', gerados: 0 });
    }

    const mapaMods = new Map<string, Modalidade>();
    for (const m of modsRaw as Modalidade[]) {
      mapaMods.set(m.id, m);
    }

    // ── 4. Nomes dos professores ────────────────────────────────────────────
    const { data: profsRaw, error: errProfs } = await supabase
      .from('professores')
      .select('id, nome');

    if (errProfs) throw errProfs;

    const mapaProfs = new Map<string, string>();
    for (const p of (profsRaw ?? []) as Professor[]) {
      mapaProfs.set(p.id, p.nome);
    }

    // ── 5. Alunos ativos com modalidades definidas ──────────────────────────
    const { data: alunosRaw, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, nome_completo, modalidades_selecionadas')
      .eq('ativo', true)
      .not('modalidades_selecionadas', 'is', null);

    if (errAlunos) throw errAlunos;

    const alunosComMods = ((alunosRaw ?? []) as Aluno[]).filter(
      (a) => Array.isArray(a.modalidades_selecionadas) && a.modalidades_selecionadas.length > 0,
    );

    if (alunosComMods.length === 0) {
      return response({ aviso: 'Nenhum aluno ativo com modalidades vinculadas.', gerados: 0 });
    }

    // ── 6. Calcula repasses por aluno ───────────────────────────────────────
    const itens: {
      professor_id: string;
      aluno_id: string;
      tipo_aula: string;
      modalidade: string;
      valor: number;
      data_referencia: string;
    }[] = [];

    const avisos: string[] = [];

    for (const aluno of alunosComMods) {
      const modIds = [...new Set(aluno.modalidades_selecionadas)];
      const modValidas = modIds.filter((id: string) => mapaMods.has(id));

      if (modValidas.length === 0) {
        avisos.push(`"${aluno.nome_completo}" tem modalidades sem professor — ignorado.`);
        continue;
      }

      const valorPorMod =
        modValidas.length === 1
          ? Number(cfg.valor_1_modalidade)
          : Number(cfg.valor_multi_modalidade);

      for (const modId of modValidas) {
        const mod = mapaMods.get(modId)!;
        itens.push({
          professor_id: mod.professor_id,
          aluno_id: aluno.id,
          tipo_aula: 'regular',
          modalidade: mod.nome,
          valor: valorPorMod,
          data_referencia: dataReferencia,
        });
      }
    }

    if (itens.length === 0) {
      return response({
        aviso: 'Nenhum repasse calculado. Verifique se as modalidades têm professores vinculados.',
        gerados: 0,
        avisos,
      });
    }

    // ── 7. Insere em lote ───────────────────────────────────────────────────
    const { error: errInsert } = await supabase
      .from('repasses_lancamentos')
      .insert(itens);

    if (errInsert) throw errInsert;

    // ── 8. Resumo por professor ─────────────────────────────────────────────
    const resumoMap = new Map<string, ResumoProf>();
    for (const item of itens) {
      const nome = mapaProfs.get(item.professor_id) ?? 'Professor';
      const atual = resumoMap.get(item.professor_id) ?? { nome, total: 0, alunos: 0 };
      atual.total += item.valor;
      atual.alunos += 1;
      resumoMap.set(item.professor_id, atual);
    }

    return response({
      sucesso: true,
      mes: `${mesStr}/${ano}`,
      gerados: itens.length,
      resumo: [...resumoMap.values()],
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