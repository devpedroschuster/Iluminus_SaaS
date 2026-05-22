// supabase/functions/gerar-repasses/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Modalidade {
  id: string;
  nome: string;
  professor_id: string | null;
  professor_nome: string;
}

interface Mensalidade {
  id: string;
  aluno_id: string | null;
  nome_visitante: string | null;
  valor_pago: number;
  tipo_aula: string;
  forma_pagamento: string;
  professor_id?: string | null;
  modalidade_nome?: string | null;
  data_vencimento?: string | null;
}

interface Aluno {
  id: string | null;
  nome_completo: string;
  modalidades_selecionadas: string[] | string;
}

interface ConfigRepasse {
  valor_1_modalidade: number;
  valor_multi_modalidade: number;
  plano_livre_pct_prof: number;
  aula_experimental_valor: number;
  aula_experimental_pct_prof: number;
  aula_avulsa_valor: number;
  aula_avulsa_pct_prof: number;
}

interface RepasseItem {
  professor_id: string;
  professor_nome: string;
  modalidade: string;
  valor: number;
}

interface ResultadoRepasse {
  valor_total: number;
  forma_pagamento: string;
  retencao_casa: number;
  itens: RepasseItem[];
  avisos: string[];
}

function normalizar(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function calcularRepasses(params: {
  mensalidade: Mensalidade;
  aluno: Aluno;
  modalidades: Modalidade[];
  config: ConfigRepasse;
}): ResultadoRepasse {
  const { mensalidade, aluno, modalidades, config } = params;
  const valorTotal = Number(mensalidade.valor_pago) || 0;
  const tipo = mensalidade.tipo_aula || 'regular';
  const avisos: string[] = [];
  let itens: RepasseItem[] = [];

  const acharProfDaModalidade = (
    referencia: string,
  ): { professor_id: string; professor_nome: string; modalidade: string } | null => {
    if (!referencia) return null;

    let m = modalidades.find((x) => x.id === referencia);

    if (!m) {
      const refLimpa = normalizar(referencia);
      m = modalidades.find((x) => normalizar(x.nome) === refLimpa);
    }

    if (!m) {
      avisos.push(`Modalidade não reconhecida: ${referencia}`);
      return null;
    }

    if (!m.professor_id) {
      avisos.push(`Modalidade "${m.nome}" encontrada, mas sem professor vinculado na base.`);
      return null;
    }

    return { professor_id: m.professor_id, professor_nome: m.professor_nome, modalidade: m.nome };
  };

  let modsAluno: string[] = aluno?.modalidades_selecionadas
    ? Array.isArray(aluno.modalidades_selecionadas)
      ? aluno.modalidades_selecionadas
      : (() => {
          try {
            return JSON.parse(aluno.modalidades_selecionadas as string);
          } catch {
            return [aluno.modalidades_selecionadas as string];
          }
        })()
    : [];

  const mods = modsAluno.filter(Boolean);
  const unicas = [...new Set(mods)] as string[];

  if (tipo === 'regular') {
    if (unicas.length === 0) {
      avisos.push('Aluno não possui modalidades vinculadas ao plano.');
    } else if (unicas.length === 1) {
      const prof = acharProfDaModalidade(unicas[0]);
      if (prof) {
        const valorProf = Math.min(Number(config.valor_1_modalidade), valorTotal);
        itens.push({ ...prof, valor: valorProf });
      }
    } else {
      unicas.forEach((modRef) => {
        const prof = acharProfDaModalidade(modRef);
        if (prof) {
          const valorProf = Math.min(Number(config.valor_multi_modalidade), valorTotal);
          itens.push({ ...prof, valor: valorProf });
        }
      });
    }
  } else if (tipo === 'plano_livre') {
    if (unicas.length === 0) {
      avisos.push('Aluno não possui modalidades para o rateio do Plano Livre.');
    } else {
      const valorParaProfs = valorTotal * (Number(config.plano_livre_pct_prof) / 100);
      const profsEnvolvidos: { professor_id: string; professor_nome: string; modalidade: string }[] = [];

      unicas.forEach((modRef) => {
        const prof = acharProfDaModalidade(modRef);
        if (prof && !profsEnvolvidos.find((p) => p.professor_id === prof.professor_id)) {
          profsEnvolvidos.push(prof);
        }
      });

      if (profsEnvolvidos.length > 0) {
        const fatia = valorParaProfs / profsEnvolvidos.length;
        profsEnvolvidos.forEach((p) => {
          itens.push({ ...p, valor: fatia });
        });
      }
    }
  } else if (tipo === 'experimental') {
    const profId = mensalidade.professor_id;
    if (!profId) {
      avisos.push('Aula Experimental sem professor informado.');
    } else {
      const profNome =
        modalidades.find((m) => m.professor_id === profId)?.professor_nome ?? 'Professor';
      const maxProf =
        Number(config.aula_experimental_valor) * (Number(config.aula_experimental_pct_prof) / 100);
      const valorProf = Math.min(maxProf, valorTotal);
      itens.push({
        professor_id: profId,
        professor_nome: profNome,
        modalidade: mensalidade.modalidade_nome ?? 'Experimental',
        valor: valorProf,
      });
    }
  } else if (tipo === 'avulsa') {
    const profId = mensalidade.professor_id;
    if (!profId) {
      avisos.push('Aula Avulsa sem professor informado.');
    } else {
      const profNome =
        modalidades.find((m) => m.professor_id === profId)?.professor_nome ?? 'Professor';
      const maxProf =
        Number(config.aula_avulsa_valor) * (Number(config.aula_avulsa_pct_prof) / 100);
      const valorProf = Math.min(maxProf, valorTotal);
      itens.push({
        professor_id: profId,
        professor_nome: profNome,
        modalidade: mensalidade.modalidade_nome ?? 'Avulsa',
        valor: valorProf,
      });
    }
  }

  const totalRepassado = itens.reduce((acc, i) => acc + i.valor, 0);
  const retencao = valorTotal - totalRepassado;

  return {
    valor_total: valorTotal,
    forma_pagamento: mensalidade.forma_pagamento,
    retencao_casa: retencao < 0 ? 0 : retencao,
    itens,
    avisos,
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { mensalidadeId } = await req.json();
    if (!mensalidadeId) {
      return new Response(JSON.stringify({ error: 'mensalidadeId é obrigatório.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: mensalidade, error: errMensa } = await supabase
      .from('mensalidades')
      .select('*')
      .eq('id', mensalidadeId)
      .single();
    if (errMensa) throw errMensa;

    let aluno: Aluno = {
      id: null,
      nome_completo: mensalidade.nome_visitante ?? 'Visitante',
      modalidades_selecionadas: [],
    };

    if (mensalidade.aluno_id) {
      const { data: alunoData, error: errAluno } = await supabase
        .from('alunos')
        .select('id, nome_completo, modalidades_selecionadas')
        .eq('id', mensalidade.aluno_id)
        .single();
      if (errAluno) throw errAluno;
      aluno = alunoData;
    }

    const { data: modsRaw, error: errMods } = await supabase.from('modalidades').select('*');
    if (errMods) throw errMods;

    const { data: profsRaw, error: errProfs } = await supabase
      .from('professores')
      .select('id, nome');
    if (errProfs) throw errProfs;

    const modalidades: Modalidade[] = (modsRaw ?? []).map((m) => {
      const profId = m.professor_id ?? null;
      const profEncontrado = (profsRaw ?? []).find((p) => p.id === profId);
      return {
        id: m.id,
        nome: m.nome,
        professor_id: profId,
        professor_nome: profEncontrado ? profEncontrado.nome : 'Professor(a)',
      };
    });

    const modalidadesLimpas: Modalidade[] = [];
    for (const mod of modalidades) {
      const idx = modalidadesLimpas.findIndex((ml) => ml.id === mod.id || ml.nome === mod.nome);
      if (idx === -1) {
        modalidadesLimpas.push(mod);
      } else if (!modalidadesLimpas[idx].professor_id && mod.professor_id) {
        modalidadesLimpas[idx] = mod;
      }
    }

    const { data: config, error: errC } = await supabase
      .from('configuracoes_repasse')
      .select('*')
      .single();
    if (errC) throw errC;

    const resultado = calcularRepasses({ mensalidade, aluno, modalidades: modalidadesLimpas, config });

    if (resultado.itens.length > 0) {
      const dataReferencia: string | null = mensalidade.data_vencimento
        ? mensalidade.data_vencimento.split('T')[0]
        : null;

      const itensPayload = resultado.itens.map((i) => ({
        professor_id: i.professor_id,
        aluno_id: aluno.id,
        tipo_aula: mensalidade.tipo_aula,
        modalidade: i.modalidade,
        valor: i.valor,
        data_referencia: dataReferencia,
      }));

      const { error: errRpc } = await supabase.rpc('substituir_repasses_mensalidade', {
        p_mensalidade_id: mensalidadeId,
        p_itens: itensPayload,
      });
      if (errRpc) throw errRpc;
    } else {
      await supabase
        .from('repasses_lancamentos')
        .delete()
        .eq('mensalidade_id', mensalidadeId);
    }

    return new Response(JSON.stringify(resultado), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});