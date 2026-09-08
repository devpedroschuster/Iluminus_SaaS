// supabase/functions/preview-repasses-mensais/index.ts
//
// DRY-RUN da geração de repasses mensais.
// Executa TODA a lógica de cálculo do `gerar-repasses-mensais` mas NÃO insere nada.
// Retorna um resumo por professor que o frontend exibe no modal de confirmação.
//
// Body: { mes: number (1–12), ano: number }
//
// Response (200):
// {
//   jaGerados: boolean,          // true → o mês já teve alguma geração anterior
//                                //   (ILU-13: informativo — totalGeral/professores/
//                                //   lancamentosPrevistos ainda refletem o que FALTA
//                                //   gerar, não mais um preview vazio bloqueado)
//   totalGeral: number,          // soma de todos os repasses calculados
//   professores: [               // ordenado por total desc
//     { professor_id, nome, total, qtdLancamentos, breakdown: { regular, plano_livre } }
//   ],
//   avisos: string[],            // alunos ignorados com motivo
//   lancamentosPrevistos: number // total de linhas que seriam inseridas
// }

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

// Mesma função de distribuição centavo-precisa do lote real.
function distribuirCentavos(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  const parcelas = Array(n).fill(base);
  const restoCentavos = Math.round((total - base * n) * 100);
  for (let i = 0; i < restoCentavos; i++) {
    parcelas[n - 1 - i] += 0.01;
    parcelas[n - 1 - i] = Math.round(parcelas[n - 1 - i] * 100) / 100;
  }
  return parcelas;
}

// ILU-11: mesma correção de gerar-repasses-mensais — `max_rows = 1000`
// (supabase/config.toml) trunca silenciosamente consultas sem paginação, o
// que faria este preview subestimar o total (e não servir como conferência
// real do lote que gerar-repasses-mensais vai gerar).
async function buscarTodasPaginas<T>(
  montarQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  tamanhoPagina = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  let pagina = 0;
  for (;;) {
    const from = pagina * tamanhoPagina;
    const to = from + tamanhoPagina - 1;
    const { data, error } = await montarQuery(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    todas.push(...data);
    if (data.length < tamanhoPagina) break;
    pagina++;
  }
  return todas;
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
    // Embora não escreva dados, este preview expõe o valor exato de comissão
    // projetada de CADA professor para qualquer mês — vazamento de
    // remuneração de terceiros para qualquer aluno/professor autenticado.
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
      console.error('[preview-repasses-mensais] erro ao checar perfil:', perfilErr.message);
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
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const inicioPeriodo = `${ano}-${mesStr}-01`;
    const fimPeriodo = `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

    // ── 1. Detecta se o lote deste mês já foi gerado antes (informativo) ────
    // ILU-13: antes, isso encerrava o preview sem calcular nada — mesmo que
    // ainda houvesse alunos elegíveis faltando no lote (ver mesma correção em
    // gerar-repasses-mensais). Agora o preview sempre calcula o que falta;
    // `jaGerados` só indica que o mês já teve alguma geração anterior.
    const { data: jaExistem, error: errJaExistem } = await supabase
      .from('repasses_lancamentos')
      .select('id')
      .eq('data_referencia', dataReferencia)
      .is('mensalidade_id', null)
      .limit(1);

    if (errJaExistem) throw errJaExistem;

    const loteJaGeradoAntes = !!(jaExistem && jaExistem.length > 0);

    // ── 2. Repasses já gerados via pagamento individual (deduplicação) ───────
    const { data: repassesPagamento, error: errRepassesPagamento } = await supabase
      .from('repasses_lancamentos')
      .select('aluno_id, modalidade, tipo_aula')
      .eq('data_referencia', dataReferencia)
      .not('mensalidade_id', 'is', null);

    if (errRepassesPagamento) throw errRepassesPagamento;

    const repassesJaPagos = new Set<string>();
    for (const r of repassesPagamento ?? []) {
      repassesJaPagos.add(`${r.aluno_id}|${r.modalidade}|${r.tipo_aula}`);
    }

    // ── 2b. Repasses do lote mensal já existentes (mesma chave do índice único
    // uq_repasse_lote_mensal) — para o preview não contar de novo o que já
    // seria ignorado pelo upsert de gerar-repasses-mensais.
    const { data: loteExistente, error: errLoteExistente } = await supabase
      .from('repasses_lancamentos')
      .select('aluno_id, modalidade, tipo_aula')
      .eq('data_referencia', dataReferencia)
      .is('mensalidade_id', null);

    if (errLoteExistente) throw errLoteExistente;

    const loteJaExistente = new Set<string>();
    for (const r of loteExistente ?? []) {
      loteJaExistente.add(`${r.aluno_id}|${r.modalidade}|${r.tipo_aula}`);
    }

    // ── 3. Configurações ────────────────────────────────────────────────────
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

    // ── 4. Modalidades com professor vinculado ──────────────────────────────
    const { data: modsRaw, error: errMods } = await supabase
      .from('modalidades')
      .select('id, nome, professor_id')
      .not('professor_id', 'is', null);

    if (errMods) throw errMods;
    if (!modsRaw || modsRaw.length === 0) {
      return response({
        jaGerados: loteJaGeradoAntes,
        totalGeral: 0,
        professores: [],
        avisos: ['Nenhuma modalidade com professor vinculado.'],
        lancamentosPrevistos: 0,
      });
    }

    const mapaMods = new Map<string, Modalidade>();
    for (const m of modsRaw as Modalidade[]) mapaMods.set(m.id, m);

    // ── 5. Professores ──────────────────────────────────────────────────────
    const { data: profsRaw, error: errProfs } = await supabase
      .from('professores')
      .select('id, nome');

    if (errProfs) throw errProfs;
    const mapaProfs = new Map<string, string>();
    for (const p of (profsRaw ?? []) as Professor[]) mapaProfs.set(p.id, p.nome);

    // ── 6. Planos ───────────────────────────────────────────────────────────
    const { data: planosRaw, error: errPlanos } = await supabase.from('planos').select('id, is_plano_livre');

    if (errPlanos) throw errPlanos;

    const mapaPlanos = new Map<string, boolean>();
    for (const p of (planosRaw ?? []) as Plano[]) {
      mapaPlanos.set(p.id, p.is_plano_livre === true);
    }

    // Pré-carrega preços dos planos livres para evitar N queries dentro do loop
    const { data: planosPreco, error: errPlanosPreco } = await supabase
      .from('planos')
      .select('id, preco')
      .eq('is_plano_livre', true);

    if (errPlanosPreco) throw errPlanosPreco;

    const mapaPrecosPlano = new Map<string, number>();
    for (const p of planosPreco ?? []) mapaPrecosPlano.set(p.id, Number(p.preco));

    // ── 7. Alunos ativos ────────────────────────────────────────────────────
    // ILU-11: pagina via buscarTodasPaginas — ver comentário na definição.
    const alunosRaw = await buscarTodasPaginas<Aluno>((from, to) =>
      supabase
        .from('alunos')
        .select('id, nome_completo, plano_id, modalidades_selecionadas')
        .eq('ativo', true)
        .not('modalidades_selecionadas', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    );

    const alunosComMods = alunosRaw.filter(
      (a) => Array.isArray(a.modalidades_selecionadas) && a.modalidades_selecionadas.length > 0,
    );

    if (alunosComMods.length === 0) {
      return response({
        jaGerados: loteJaGeradoAntes,
        totalGeral: 0,
        professores: [],
        avisos: ['Nenhum aluno ativo com modalidades vinculadas.'],
        lancamentosPrevistos: 0,
      });
    }

    const avisos: string[] = [];

    // ── 7b. Filtra só alunos adimplentes no mês de referência (ILU-13) ──────
    // Este preview precisa espelhar exatamente a mesma regra usada no lote real
    // (`gerar-repasses-mensais`) — caso contrário mostraria comissão para um
    // aluno que a geração de verdade acabaria excluindo. Alinhado com o time:
    // comissão do lote mensal exige a mensalidade `regular` do mês de
    // referência com `status = 'pago'`, igual à regra do pagamento individual.
    const { data: mensalidadesPagas, error: errMensalidadesPagas } = await supabase
      .from('mensalidades')
      .select('aluno_id')
      .eq('tipo_aula', 'regular')
      .eq('status', 'pago')
      .gte('data_vencimento', inicioPeriodo)
      .lte('data_vencimento', fimPeriodo);

    if (errMensalidadesPagas) throw errMensalidadesPagas;

    const alunosAdimplentes = new Set((mensalidadesPagas ?? []).map((m) => m.aluno_id as string));
    const alunosComModsAdimplentes = alunosComMods.filter((a) => {
      const adimplente = alunosAdimplentes.has(a.id);
      if (!adimplente) {
        avisos.push(`"${a.nome_completo}": mensalidade do mês não está paga — sem repasse.`);
      }
      return adimplente;
    });

    interface PresencaComAgenda {
      aluno_id: string;
      agenda: { modalidade_id: string } | null;
    }

    // ── 8. Presenças do mês (para plano livre) ──────────────────────────────
    //    IMPORTANTE: status='presente' — exclui 'agendado'/'falta'/'cancelado'.
    // ILU-11: pagina via buscarTodasPaginas — ver comentário na definição.
    const presencasRaw = await buscarTodasPaginas<PresencaComAgenda>((from, to) =>
      supabase
        .from('presencas')
        .select('aluno_id, agenda(modalidade_id)')
        .eq('status', 'presente')
        .gte('data_checkin', `${inicioPeriodo}T00:00:00-03:00`)
        .lte('data_checkin', `${fimPeriodo}T23:59:59-03:00`)
        .not('aula_id', 'is', null)
        .order('aluno_id', { ascending: true })
        .range(from, to)
        .returns<PresencaComAgenda[]>(),
    );

    const presencasPorAluno = new Map<string, Set<string>>();
    for (const p of presencasRaw) {
      const modId = p.agenda?.modalidade_id;
      if (!p.aluno_id || !modId) continue;
      if (!presencasPorAluno.has(p.aluno_id)) presencasPorAluno.set(p.aluno_id, new Set());
      presencasPorAluno.get(p.aluno_id)!.add(modId);
    }

    // ── 9. Calcula (sem inserir) ────────────────────────────────────────────
    interface ItemPreview {
      professor_id: string;
      tipo_aula: 'regular' | 'plano_livre';
      valor: number;
    }

    const itens: ItemPreview[] = [];

    for (const aluno of alunosComModsAdimplentes) {
      const isLivre = aluno.plano_id ? (mapaPlanos.get(aluno.plano_id) ?? false) : false;

      if (isLivre) {
        const modidsFrequentadas = presencasPorAluno.get(aluno.id);
        if (!modidsFrequentadas || modidsFrequentadas.size === 0) {
          avisos.push(`"${aluno.nome_completo}" (plano livre) sem presenças no mês — sem repasse.`);
          continue;
        }

        const modsLivreValidas: Modalidade[] = [];
        for (const modId of modidsFrequentadas) {
          const mod = mapaMods.get(modId);
          if (mod) modsLivreValidas.push(mod);
        }

        if (modsLivreValidas.length === 0) {
          avisos.push(`"${aluno.nome_completo}" (plano livre): modalidades sem professor — sem repasse.`);
          continue;
        }

        const preco = aluno.plano_id ? mapaPrecosPlano.get(aluno.plano_id) : undefined;
        if (!preco) {
          avisos.push(`"${aluno.nome_completo}" (plano livre): plano sem preço — sem repasse.`);
          continue;
        }

        const parteProfs = Number(preco) * (Number(cfg.plano_livre_pct_prof) / 100);
        const n = modsLivreValidas.length;
        const valoresPorMod = distribuirCentavos(parteProfs, n);

        for (let i = 0; i < n; i++) {
          const mod = modsLivreValidas[i];
          const chave = `${aluno.id}|${mod.nome}|plano_livre`;
          if (repassesJaPagos.has(chave)) {
            avisos.push(`"${aluno.nome_completo}" (plano livre, ${mod.nome}): já gerado via pagamento — ignorado.`);
            continue;
          }
          if (loteJaExistente.has(chave)) {
            continue;
          }
          itens.push({ professor_id: mod.professor_id, tipo_aula: 'plano_livre', valor: valoresPorMod[i] });
        }
      } else {
        const modIds = [...new Set(aluno.modalidades_selecionadas)];
        const modValidas = modIds.filter((id: string) => mapaMods.has(id));

        if (modValidas.length === 0) {
          avisos.push(`"${aluno.nome_completo}": modalidades sem professor — ignorado.`);
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
            avisos.push(`"${aluno.nome_completo}" (${mod.nome}): já gerado via pagamento — ignorado.`);
            continue;
          }
          if (loteJaExistente.has(chave)) {
            continue;
          }
          itens.push({ professor_id: mod.professor_id, tipo_aula: 'regular', valor: valorPorMod });
        }
      }
    }

    // ── 10. Agrega resumo por professor ─────────────────────────────────────
    interface ResumoProf {
      professor_id: string;
      nome: string;
      total: number;
      qtdLancamentos: number;
      breakdown: { regular: number; plano_livre: number };
    }

    const resumoMap = new Map<string, ResumoProf>();
    let totalGeral = 0;

    for (const item of itens) {
      totalGeral += item.valor;
      if (!resumoMap.has(item.professor_id)) {
        resumoMap.set(item.professor_id, {
          professor_id: item.professor_id,
          nome: mapaProfs.get(item.professor_id) ?? 'Professor',
          total: 0,
          qtdLancamentos: 0,
          breakdown: { regular: 0, plano_livre: 0 },
        });
      }
      const r = resumoMap.get(item.professor_id)!;
      r.total = Math.round((r.total + item.valor) * 100) / 100;
      r.qtdLancamentos += 1;
      r.breakdown[item.tipo_aula] = Math.round((r.breakdown[item.tipo_aula] + item.valor) * 100) / 100;
    }

    const professores = [...resumoMap.values()].sort((a, b) => b.total - a.total);

    return response({
      jaGerados: loteJaGeradoAntes,
      mes: `${mesStr}/${ano}`,
      totalGeral: Math.round(totalGeral * 100) / 100,
      professores,
      avisos,
      lancamentosPrevistos: itens.length,
      config: {
        valor_1_modalidade: cfg.valor_1_modalidade,
        valor_multi_modalidade: cfg.valor_multi_modalidade,
        plano_livre_pct_prof: cfg.plano_livre_pct_prof,
      },
    });

  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err);
    console.error('[preview-repasses-mensais] ERRO:', message);
    return response({ error: message }, 500);
  }
});