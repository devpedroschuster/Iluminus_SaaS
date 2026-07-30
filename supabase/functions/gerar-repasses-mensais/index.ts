// supabase/functions/gerar-repasses-mensais/index.ts
//
// Gera repasses para todos os professores com base nos alunos MATRICULADOS.
//
// Lógica por tipo de plano:
//   - Regular    → valor fixo por modalidade matriculada (cfg.valor_1_modalidade / valor_multi_modalidade)
//   - Plano Livre → pct_prof × preço do plano, dividido entre as modalidades FREQUENTADAS no mês (via presencas)
//
// NOTA ARQUITETURAL — Avulsa e Experimental:
//   Aulas avulsas e experimentais são cobranças pontuais sem vínculo de matrícula.
//   Os respectivos repasses são gerados no momento do pagamento via `gerar-repasses`
//   (com mensalidade_id preenchido). O lote mensal trata diretamente apenas os tipos
//   com matrícula (regular / plano_livre) e, na etapa 11, executa uma RECONCILIAÇÃO:
//   varre mensalidades pagas do tipo avulsa/experimental no mês que NÃO possuem
//   repasse correspondente (por falha de rede, timeout, etc. no momento do pagamento)
//   e chama `gerar-repasses` para cada uma, fechando o "buraco" que antes fazia
//   comissões de aula avulsa desaparecerem silenciosamente do cálculo.
//
// AUDITORIA 2026-07 — Correções aplicadas:
//   FIX-01: todo `error` de query Supabase agora é checado e propagado (throw).
//           Antes, erros de rede/RLS em queries pontuais (ex.: busca de preço do
//           plano, busca de modalidades) eram descartados silenciosamente e o
//           código tratava o resultado vazio como "aluno sem professor vinculado"
//           ou "plano sem preço", mascarando uma falha técnica como regra de
//           negócio. Isso fazia alunos com professor de fato vinculado sumirem
//           do repasse sem nenhum aviso real do problema.
//   FIX-02: eliminado N+1 na busca de preço do plano livre — `preco` agora vem
//           junto com `is_plano_livre` na mesma query de planos (passo 5),
//           evitando 1 round-trip extra ao banco por aluno de plano livre.
//   FIX-03: inserção do lote passou de `insert` para `upsert` com
//           `ignoreDuplicates: true` sobre uma constraint única (ver comentário
//           no passo 9). Antes, a checagem "já existem repasses?" (passo 1) e o
//           insert final (passo 9) formavam uma janela de corrida (TOCTOU): duas
//           chamadas concorrentes (duplo clique, retry de rede) passavam ambas
//           pela checagem e ambas inseriam o mesmo lote, duplicando lançamentos
//           para o mesmo aluno/modalidade/mês. Com upsert + constraint única, a
//           segunda execução concorrente simplesmente não insere linhas repetidas.
//   FIX-04: nova etapa 11 de reconciliação de avulsas/experimentais (ver nota
//           arquitetural acima).
//
// Chamada manual via: supabase.functions.invoke('gerar-repasses-mensais', { body: { mes, ano } })
//
// PRÉ-REQUISITO DE BANCO (rodar uma vez, via migration):
//   CREATE UNIQUE INDEX IF NOT EXISTS uq_repasse_lote_mensal
//     ON repasses_lancamentos (aluno_id, modalidade, tipo_aula, data_referencia)
//     WHERE mensalidade_id IS NULL;

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

interface PlanoInfo {
  is_plano_livre: boolean;
  preco: number | null;
}

interface ResumoProf {
  nome: string;
  total: number;
  alunos: number;
}

// REP-03: interface expandida com todos os campos da tabela configuracoes_repasse.
// Os campos de avulsa/experimental não são usados no cálculo direto do lote mensal
// (ver nota arquitetural acima), mas são declarados aqui para manter a interface em
// sincronia com a tabela e facilitar futuras extensões sem necessidade de descoberta.
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

// REP-07: distribui `total` em centavos exatos entre `n` parcelas.
// Trunca todas as parcelas para 2 casas decimais e redistribui os centavos
// restantes (1 centavo por vez) para as últimas parcelas, garantindo que
// sum(parcelas) === total sem acúmulo de erro de arredondamento.
//
// Exemplo: distribuirCentavos(50.00, 3) → [16.66, 16.67, 16.67]  (soma 50.00)
//          distribuirCentavos(100.00, 3) → [33.33, 33.33, 33.34]  (soma 100.00)
function distribuirCentavos(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor((total / n) * 100) / 100; // trunca, não arredonda
  const parcelas = Array(n).fill(base);
  const restoCentavos = Math.round((total - base * n) * 100); // centavos que sobram
  for (let i = 0; i < restoCentavos; i++) {
    parcelas[n - 1 - i] += 0.01; // distribui do fim para o início
    parcelas[n - 1 - i] = Math.round(parcelas[n - 1 - i] * 100) / 100; // limpa float noise
  }
  return parcelas;
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
    // FIX-01: error agora é checado — antes uma falha nesta query fazia `jaExistem`
    // ficar `undefined`, o que era tratado como "nunca gerado" e permitia
    // gerar o lote de novo mesmo quando não deveríamos ter certeza disso.
    const { data: jaExistem, error: errJaExistem } = await supabase
      .from('repasses_lancamentos')
      .select('id')
      .eq('data_referencia', dataReferencia)
      .is('mensalidade_id', null)
      .limit(1);

    if (errJaExistem) throw errJaExistem;

    if (jaExistem && jaExistem.length > 0) {
      return response({
        error: `Repasses de ${mesStr}/${ano} já foram gerados. Exclua-os antes de regerar.`,
        jaGerados: true,
      }, 409);
    }

    // ── 1b. Repasses já gerados via pagamento individual neste mês ──────────
    // (mensalidade_id IS NOT NULL) — usados para não duplicar no lote.
    const { data: repassesPagamento, error: errRepassesPagamento } = await supabase
      .from('repasses_lancamentos')
      .select('aluno_id, modalidade, tipo_aula')
      .eq('data_referencia', dataReferencia)
      .not('mensalidade_id', 'is', null);

    if (errRepassesPagamento) throw errRepassesPagamento;

    // Chave: aluno_id|modalidade|tipo_aula
    const repassesJaPagos = new Set<string>();
    for (const r of repassesPagamento ?? []) {
      repassesJaPagos.add(`${r.aluno_id}|${r.modalidade}|${r.tipo_aula}`);
    }

    // ── 2. Configurações de repasse ─────────────────────────────────────────
    // REP-03: select expandido com todos os campos da tabela.
    const { data: config, error: errConfig } = await supabase
      .from('configuracoes_repasse')
      .select(`
        valor_1_modalidade,
        valor_multi_modalidade,
        plano_livre_pct_casa,
        plano_livre_pct_prof,
        aula_avulsa_valor,
        aula_avulsa_pct_prof,
        aula_avulsa_pct_casa,
        aula_experimental_valor,
        aula_experimental_pct_prof
      `)
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

    // ── 5. Planos — identifica quais são "plano livre" e já traz o preço ────
    // FIX-02: `preco` incluído aqui elimina o N+1 que antes existia no passo 8
    // (uma query de preço por aluno de plano livre, dentro do loop).
    const { data: planosRaw, error: errPlanos } = await supabase
      .from('planos')
      .select('id, is_plano_livre, preco');

    if (errPlanos) throw errPlanos;

    const mapaPlanos = new Map<string, PlanoInfo>();
    for (const p of (planosRaw ?? []) as { id: string; is_plano_livre: boolean; preco: number | null }[]) {
      mapaPlanos.set(p.id, { is_plano_livre: p.is_plano_livre === true, preco: p.preco ?? null });
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
    //    IMPORTANTE: status='presente' — exclui 'agendado'/'falta'/'cancelado',
    //    que não devem gerar comissão (só presença real confirmada).
    const { data: presencasRaw, error: errPresencas } = await supabase
      .from('presencas')
      .select(`
        aluno_id,
        agenda (
          modalidade_id
        )
      `)
      .eq('status', 'presente')
      .gte('data_checkin', `${inicioPeriodo}T00:00:00`)
      .lte('data_checkin', `${fimPeriodo}T23:59:59`)
      .not('aula_id', 'is', null);

    if (errPresencas) throw errPresencas;

    // Mapa: aluno_id → Set de modalidade_ids frequentadas no mês
    const presencasPorAluno = new Map<string, Set<string>>();
    for (const p of presencasRaw ?? []) {
      const modId = (p.agenda as any)?.modalidade_id;
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
      const planoInfo = aluno.plano_id ? mapaPlanos.get(aluno.plano_id) : undefined;
      const isLivre = planoInfo?.is_plano_livre ?? false;

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

        // FIX-02: preço já vem do mapaPlanos — sem query extra por aluno.
        if (!planoInfo?.preco) {
          avisos.push(`"${aluno.nome_completo}" (plano livre): plano sem preço definido — sem repasse.`);
          continue;
        }

        const valorTotal = Number(planoInfo.preco);
        const pctProf = Number(cfg.plano_livre_pct_prof) / 100;
        const parteProfs = valorTotal * pctProf;

        // REP-07: distribui parteProfs entre as modalidades sem perda de centavo.
        const n = modsLivreValidas.length;
        const valoresPorMod = distribuirCentavos(parteProfs, n);

        for (let i = 0; i < n; i++) {
          const mod = modsLivreValidas[i];
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
            valor: valoresPorMod[i],
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

        // Regular usa valor fixo por modalidade — sem divisão, sem problema de arredondamento.
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

    // ── 9. Insere em lote ───────────────────────────────────────────────────
    // FIX-03: upsert + ignoreDuplicates sobre constraint única, garantindo que
    // execuções concorrentes (duplo clique, retry de rede) não dupliquem
    // lançamentos, mesmo que ambas passem pela checagem do passo 1.
    // Requer a unique index descrita no cabeçalho do arquivo.
    if (itens.length > 0) {
      const { error: errInsert } = await supabase
        .from('repasses_lancamentos')
        .upsert(itens, {
          onConflict: 'aluno_id,modalidade,tipo_aula,data_referencia',
          ignoreDuplicates: true,
        });

      if (errInsert) throw errInsert;
    }

    // ── 10. Resumo por professor (apenas dos itens deste lote) ──────────────
    const resumoMap = new Map<string, ResumoProf>();
    for (const item of itens) {
      const nome = mapaProfs.get(item.professor_id) ?? 'Professor';
      const atual = resumoMap.get(item.professor_id) ?? { nome, total: 0, alunos: 0 };
      atual.total += item.valor;
      atual.alunos += 1;
      resumoMap.set(item.professor_id, atual);
    }

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

    if (itens.length === 0 && avulsasReconciliadas === 0) {
      return response({
        aviso: 'Nenhum repasse calculado. Verifique se as modalidades têm professores vinculados.',
        gerados: 0,
        avisos,
      });
    }

    return response({
      sucesso: true,
      mes: `${mesStr}/${ano}`,
      gerados: itens.length,
      avulsasReconciliadas,
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