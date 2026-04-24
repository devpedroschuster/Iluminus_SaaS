import { supabase } from '../lib/supabase';

export const agendamentoService = {
  
  async verificarDisponibilidade(aulaId, dataAula, alunoId = null) {
    if (!aulaId) return null;

    try {
      const { data, error } = await supabase.rpc('verificar_disponibilidade_v2', {
        p_aula_id: aulaId,
        p_data: dataAula,
        p_aluno_id: alunoId || null 
      });

      if (error) throw error;
      return data; 

    } catch (error) {
      console.error("Erro SQL:", error);
      
      alert("ERRO NO BANCO DE DADOS: " + (error.message || JSON.stringify(error)));
      
      return { 
        podeAgendarLivremente: true, 
        avisoCritico: null,
        capacidadeMax: 15,
        ocupacaoAtual: 0,
        limiteSemanal: 0,
        usoSemanal: 0,
        isLivre: false, 
        modNome: 'Atividade (Erro na Rede)', 
        temModalidadeNoPlano: true
      }; 
    }
  },

  async agendarAulaAdmin(dados) {
    if (!dados.ignorarAvisos) {
       const checagem = await agendamentoService.verificarDisponibilidade(dados.aula_id, dados.data_aula, dados.aluno_id);
       if (!checagem.podeAgendarLivremente) throw new Error(checagem.avisoCritico);
    }
    const payload = { aula_id: dados.aula_id, data_checkin: `${dados.data_aula}T12:00:00` };
    if (dados.tipo === 'visitante') {
      payload.nome_visitante = dados.nome_visitante;
      payload.telefone_visitante = dados.telefone_visitante || null;
      payload.status_conversao = 'pendente';
      payload.aluno_id = null;
    } else {
      payload.aluno_id = dados.aluno_id;
      payload.nome_visitante = null;
    }
    const { error } = await supabase.from('presencas').insert([payload]);
    if (error && error.code === '23505') throw new Error("Este aluno já possui um agendamento nesta mesma turma e mesma data.");
    else if (error) throw error;
  },

  async cancelarAgendamento(id) {
    const { data, error } = await supabase.from('presencas').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  },

  async listarPresencasPeriodo(inicio, fim) {
    const { data, error } = await supabase.from('presencas').select('id, data_checkin, aula_id, nome_visitante, alunos ( id, nome_completo )').gte('data_checkin', `${inicio}T00:00:00`).lte('data_checkin', `${fim}T23:59:59`);
    if (error) throw error;
    return data;
  },

  async listarPresencas(aulaId, dataAula) {
    const inicioDia = `${dataAula}T00:00:00`;
    const fimDia = `${dataAula}T23:59:59`;
    const { data, error } = await supabase.from('presencas').select('id, data_checkin, alunos ( id, nome_completo )').eq('aula_id', aulaId).gte('data_checkin', inicioDia).lte('data_checkin', fimDia);
    if (error) throw error;
    return data;
  },

  async listarChamadaCompleta(aulaId, dataAula) {
    const inicioDia = `${dataAula}T00:00:00`;
    const fimDia = `${dataAula}T23:59:59`;

    const [ { data: avulsos }, { data: fixos }, { data: excecoes } ] = await Promise.all([
      supabase.from('presencas').select('id, nome_visitante, alunos(id, nome_completo)').eq('aula_id', aulaId).gte('data_checkin', inicioDia).lte('data_checkin', fimDia),
      supabase.from('agenda_fixa').select('id, alunos(id, nome_completo)').eq('aula_id', aulaId),
      supabase.from('agenda_excecoes').select('aluno_id, tipo').eq('aula_id', aulaId).eq('data_especifica', dataAula)
    ]);

    const excecoesMap = new Map(excecoes?.map(e => [e.aluno_id, e.tipo]) || []);
    const lista = [];

    if (fixos) {
      fixos.forEach(f => {
        lista.push({
           id_relacao: f.id, aluno_id: f.alunos.id, nome: f.alunos.nome_completo,
           tipo: 'fixo', status: excecoesMap.has(f.alunos.id) ? excecoesMap.get(f.alunos.id) : 'presente'
        });
      });
    }
    if (avulsos) {
      avulsos.forEach(a => {
        if (!a.nome_visitante && lista.find(l => l.aluno_id === a.alunos?.id)) return;
        lista.push({
           id_relacao: a.id, aluno_id: a.alunos?.id || null, nome: a.nome_visitante || a.alunos?.nome_completo,
           tipo: a.nome_visitante ? 'experimental' : 'avulso', status: 'presente'
        });
      });
    }
    return lista.sort((a,b) => a.nome.localeCompare(b.nome));
  },

  async registrarFalta(alunoId, aulaId, dataEspecifica) {
    const { error } = await supabase.from('agenda_excecoes').insert({ aluno_id: alunoId, aula_id: aulaId, data_especifica: dataEspecifica, tipo: 'ausencia' });
    if (error) throw error;
  },

  async removerFalta(alunoId, aulaId, dataEspecifica) {
    const { error } = await supabase.from('agenda_excecoes').delete().match({ aluno_id: alunoId, aula_id: aulaId, data_especifica: dataEspecifica });
    if (error) throw error;
  }
};