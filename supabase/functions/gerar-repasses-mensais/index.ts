// supabase/functions/gerar-repasses-mensais/index.ts
//
// Gera repasses para todos os professores com base nos alunos MATRICULADOS.
//
// Lógica por tipo de plano:
//   - Regular   → valor fixo por modalidade matriculada (cfg.valor_1_modalidade / valor_multi_modalidade)
//   - Plano Livre → 50% casa + 50% dividido entre as modalidades FREQUENTADAS no mês (via presencas)
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
  plano_id: string | null;
  modalidades_selecionadas: string[];
}

interface Plano {
  id: string;
  is_plano_livre: boolean;
}

interface ResumoProf {
  nome: string;
  total: number;
  alunos: number;
}

interface ConfigRepasse {
  valor_1_modalidade: number;
  valor_multi_modalidade: number;
  plano_livre_pct_casa: number;
  plano_livre_pct_prof: number;
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

    // Período completo do mês
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const inicioPeriodo = `${ano}-${mesStr}-01`;
    const fimPeriodo = `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

    // ── 1. Previne dupla geração no mesmo mês ───────────────────────────────
    // Bloqueia apenas se já existirem repasses do LOTE MENSAL (mensalidade_id IS NULL)
    // para este mês. Repasses originados de pagamentos individuais (gerar-repasses,
    // mensalidade_id preenchido) não bloqueiam o lote — eles serão deduplicados
    // no passo 8 abaixo.
    const { data: jaExistem } = await supabase
      .from('repasses_lancamentos')
      .select('id')
      .eq('data_referencia', dataReferencia)
      .is('mensalidade_id', null)
      .limit(1);

    if (jaExistem && jaExistem.length > 0) {
      return response({
        error: `Repasses de ${mesStr}/${ano} já foram gerados. Exclua-os antes de regerar.`,
        jaGerados: true,
      }, 409);
    }

    // ── 1b. Repasses já gerados via pagamento individual neste mês ──────────
    // (mensalidade_id IS NOT NULL) — usados para não duplicar no lote.
    const { data: repassesPagamento } = await supabase
      .from('repasses_lancamentos')
      .select('aluno_id, modalidade, tipo_aula')
      .eq('data_referencia', dataReferencia)
      .not('mensalidade_id', 'is', null);

    // Chave: aluno_id|modalidade|tipo_aula
    const repassesJaPagos = new Set<string>();
    for (const r of repassesPagamento ?? []) {
      repassesJaPagos.add(`${r.aluno_id}|${r.modalidade}|${r.tipo_aula}`);
    }

    // ── 2. Configurações de repasse ─────────────────────────────────────────
    const { data: config, error: errConfig } = await supabase
      .from('configuracoes_repasse')
      .select('valor_1_modalidade, valor_multi_modalidade, plano_livre_pct_casa, plano_livre_pct_prof')
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

    // ── 5. Planos — identifica quais são "plano livre" ──────────────────────
    const { data: planosRaw } = await supabase
      .from('planos')
      .select('id, is_plano_livre');

    const mapaPlanos = new Map<string, boolean>();
    for (const p of (planosRaw ?? []) as Plano[]) {
      mapaPlanos.set(p.id, p.is_plano_livre === true);
    }

    // ── 6. Alunos ativos com modalidades definidas ──────────────────────────
    const { data: alunosRaw, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, nome_completo, plano_id, modalidades_selecionadas')
      .eq('ativo', true)
      .not('modalidades_selecionadas', 'is', null);

    if (errAlunos) throw errAlunos;

    const alunosComMods = ((alunosRaw ?? []) as Aluno[]).filter(
      (a) => Array.isArray(a.modalidades_selecionadas) && a.modalidades_selecionadas.length > 0,
    );

    if (alunosComMods.length === 0) {
      return response({ aviso: 'Nenhum aluno ativo com modalidades vinculadas.', gerados: 0 });
    }

    // ── 7. Presenças do mês (apenas com aula_id — vinculadas a modalidade) ──
    //    Necessário para calcular repasse do plano livre.
    const { data: presencasRaw } = await supabase
      .from('presencas')
      .select(`
        aluno_id,
        agenda (
          modalidade_id
        )
      `)
      .gte('data_checkin', `${inicioPeriodo}T00:00:00`)
      .lte('data_checkin', `${fimPeriodo}T23:59:59`)
      .not('aula_id', 'is', null);

    // Mapa: aluno_id → Set de modalidade_ids frequentadas no mês
    const presencasPorAluno = new Map<string, Set<string>>();
    for (const p of presencasRaw ?? []) {
      const modId = p.agenda?.modalidade_id;
      if (!p.aluno_id || !modId) continue;

      if (!presencasPorAluno.has(p.aluno_id)) {
        presencasPorAluno.set(p.aluno_id, new Set());
      }
      presencasPorAluno.get(p.aluno_id)!.add(modId);
    }

    // ── 8. Calcula repasses por aluno ───────────────────────────────────────
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
      const isLivre = aluno.plano_id ? (mapaPlanos.get(aluno.plano_id) ?? false) : false;

      if (isLivre) {
        // ── PLANO LIVRE: usa modalidades FREQUENTADAS no mês ────────────────
        const modidsFrequentadas = presencasPorAluno.get(aluno.id);

        if (!modidsFrequentadas || modidsFrequentadas.size === 0) {
          avisos.push(`"${aluno.nome_completo}" (plano livre) sem presenças no mês — sem repasse.`);
          continue;
        }

        // Filtra para modalidades que têm professor vinculado
        const modsLivreValidas: Modalidade[] = [];
        for (const modId of modidsFrequentadas) {
          const mod = mapaMods.get(modId);
          if (mod) modsLivreValidas.push(mod);
        }

        if (modsLivreValidas.length === 0) {
          avisos.push(`"${aluno.nome_completo}" (plano livre): modalidades frequentadas sem professor — sem repasse.`);
          continue;
        }

        // Busca o preço do plano diretamente
const { data: plano } = await supabase
  .from('planos')
  .select('preco')
  .eq('id', aluno.plano_id)
  .single();

if (!plano?.preco) {
  avisos.push(`"${aluno.nome_completo}" (plano livre): plano sem preço definido — sem repasse.`);
  continue;
}

const valorTotal = Number(plano.preco);

        const pctProf = Number(cfg.plano_livre_pct_prof) / 100;
        const parteProfs = valorTotal * pctProf;
        const valorPorMod = parteProfs / modsLivreValidas.length;

        for (const mod of modsLivreValidas) {
          const chave = `${aluno.id}|${mod.nome}|plano_livre`;
          if (repassesJaPagos.has(chave)) {
            avisos.push(`"${aluno.nome_completo}" (plano livre, ${mod.nome}): repasse já gerado via pagamento — ignorado no lote.`);
            continue;
          }
          itens.push({
            professor_id: mod.professor_id,
            aluno_id: aluno.id,
            tipo_aula: 'plano_livre',
            modalidade: mod.nome,
            valor: Math.round(valorPorMod * 100) / 100,
            data_referencia: dataReferencia,
          });
        }

      } else {
        // ── REGULAR: usa modalidades MATRICULADAS ───────────────────────────
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
          const chave = `${aluno.id}|${mod.nome}|regular`;
          if (repassesJaPagos.has(chave)) {
            avisos.push(`"${aluno.nome_completo}" (${mod.nome}): repasse já gerado via pagamento — ignorado no lote.`);
            continue;
          }
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
    }

    if (itens.length === 0) {
      return response({
        aviso: 'Nenhum repasse calculado. Verifique se as modalidades têm professores vinculados.',
        gerados: 0,
        avisos,
      });
    }

    // ── 9. Insere em lote ───────────────────────────────────────────────────
    const { error: errInsert } = await supabase
      .from('repasses_lancamentos')
      .insert(itens);

    if (errInsert) throw errInsert;

    // ── 10. Resumo por professor ────────────────────────────────────────────
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