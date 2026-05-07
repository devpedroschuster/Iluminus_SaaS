import { supabase } from '../lib/supabase';

const normalizar = (str) => {
  if (!str) return '';
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
};

export function calcularRepasses({ mensalidade, aluno, modalidades, config }) {
  const valorTotal = Number(mensalidade.valor_pago) || 0;
  const tipo = mensalidade.tipo_aula || 'regular';
  const avisos = [];
  let itens = [];

  const acharProfDaModalidade = (referencia) => {
    if (!referencia) return null;

    let m = modalidades.find((x) => x.id === referencia);

    if (!m) {
      const refLimpa = normalizar(referencia);
      m = modalidades.find((x) => normalizar(x.nome) === refLimpa);
    }

    if (!m) {
      console.warn(`❌ [Motor Repasse] Modalidade não encontrada no Banco: ${referencia}`);
      avisos.push(`Modalidade não reconhecida: ${referencia}`);
      return null;
    }

    if (!m.professor_id) {
      avisos.push(`Modalidade "${m.nome}" encontrada, mas sem professor vinculado na base.`);
      return null;
    }

    return { professor_id: m.professor_id, professor_nome: m.professor_nome, modalidade: m.nome };
  };

  let modsAluno = aluno?.modalidades_selecionadas || [];
  if (typeof modsAluno === 'string') {
    try { modsAluno = JSON.parse(modsAluno); } catch (e) { modsAluno = [modsAluno]; }
  }
  const mods = modsAluno.filter(Boolean);
  const unicas = [...new Set(mods)];

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
      const profsEnvolvidos = [];

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
      const profNome = modalidades.find(m => m.professor_id === profId)?.professor_nome || 'Professor';
      const maxProf = Number(config.aula_experimental_valor) * (Number(config.aula_experimental_pct_prof) / 100);
      const valorProf = Math.min(maxProf, valorTotal);
      itens.push({
        professor_id: profId,
        professor_nome: profNome,
        modalidade: mensalidade.modalidade_nome || 'Experimental',
        valor: valorProf
      });
    }
  } else if (tipo === 'avulsa') {
    const profId = mensalidade.professor_id;
    if (!profId) {
      avisos.push('Aula Avulsa sem professor informado.');
    } else {
      const profNome = modalidades.find(m => m.professor_id === profId)?.professor_nome || 'Professor';
      const maxProf = Number(config.aula_avulsa_valor) * (Number(config.aula_avulsa_pct_prof) / 100);
      const valorProf = Math.min(maxProf, valorTotal);
      itens.push({
        professor_id: profId,
        professor_nome: profNome,
        modalidade: mensalidade.modalidade_nome || 'Avulsa',
        valor: valorProf
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

export async function gerarRepassesDaMensalidade(mensalidadeId) {
  console.log("== INICIANDO MOTOR DE REPASSE ==");
  
  const { data: mensalidade, error: errMensa } = await supabase
    .from('mensalidades')
    .select('*')
    .eq('id', mensalidadeId)
    .single();
  if (errMensa) throw errMensa;
  
  const { data: aluno, error: errAluno } = await supabase
    .from('alunos')
    .select('id, nome_completo, modalidades_selecionadas')
    .eq('id', mensalidade.aluno_id)
    .single();
  if (errAluno) throw errAluno;

  const { data: modsRaw, error: errMods } = await supabase
    .from('modalidades')
    .select('*');
  if (errMods) throw errMods;

  const { data: profsRaw, error: errProfs } = await supabase
    .from('professores')
    .select('id, nome');
  if (errProfs) throw errProfs;

  const modalidades = (modsRaw || []).map((m) => {
    const idDoProfessor = m.professor_id || m.id_professor || m.professores_id || m.professor;
    const profEncontrado = (profsRaw || []).find(p => p.id === idDoProfessor);
    
    return {
      id: m.id,
      nome: m.nome,
      professor_id: idDoProfessor,
      professor_nome: profEncontrado ? profEncontrado.nome : 'Professor(a)',
    };
  });
  
  const modalidadesLimpas = [];
  modalidades.forEach(mod => {
     const index = modalidadesLimpas.findIndex(ml => ml.id === mod.id || ml.nome === mod.nome);
     if (index === -1) {
        modalidadesLimpas.push(mod);
     } else if (!modalidadesLimpas[index].professor_id && mod.professor_id) {
        modalidadesLimpas[index] = mod;
     }
  });

  const { data: config, error: errC } = await supabase
    .from('configuracoes_repasse')
    .select('*')
    .single();
  if (errC) throw errC;

  const resultado = calcularRepasses({ mensalidade, aluno, modalidades: modalidadesLimpas, config });
  console.log("5. Resultado Final:", resultado);

  if (resultado.itens.length > 0) {
    const itensPayload = resultado.itens.map((i) => ({
      professor_id: i.professor_id,
      aluno_id: aluno.id,
      tipo_aula: mensalidade.tipo_aula,
      modalidade: i.modalidade,
      valor: i.valor,
    }));

    const { error: errRpc } = await supabase.rpc('substituir_repasses_mensalidade', {
      p_mensalidade_id: mensalidadeId,
      p_itens: itensPayload,
    });
    if (errRpc) throw errRpc;
  } else {
    await supabase.from('repasses_lancamentos').delete().eq('mensalidade_id', mensalidadeId);
  }

  return resultado;
}

export async function listarRepassesProfessor(professorId, mesAno) {
  const inicio = `${mesAno}-01T00:00:00`;
  const [ano, mes] = mesAno.split('-').map(Number);
  const ultimo = new Date(ano, mes, 0).toISOString().split('T')[0];
  const fim = `${ultimo}T23:59:59`;

  const { data, error } = await supabase
    .from('repasses_lancamentos')
    .select('id, valor, tipo_aula, modalidade, created_at, alunos(nome_completo)')
    .eq('professor_id', professorId)
    .gte('created_at', inicio)
    .lte('created_at', fim)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}