import { supabase } from '../lib/supabase';

export const agendaService = {
  async listarProfessores() {
    const { data, error } = await supabase
      .from('professores')
      .select('*')
      .eq('ativo', true)
      .order('nome');
      
    if (error) throw error;
    return data;
  },

  async listarModalidades() {
    const { data, error } = await supabase
      .from('modalidades')
      .select('*')
      .order('nome');
      
    if (error) throw error;
    return data;
  },

  async listarGrade() {
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;

    let professorId = null;

    if (email) {
      const { data: prof } = await supabase
        .from('professores')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (prof) professorId = prof.id;
    }

    const { data: aulas, error } = await supabase
      .from('agenda')
      .select('*, professores(nome)') 
      .order('horario', { ascending: true });

    if (error) throw error;

    if (!professorId) return aulas;

    const { data: modalidadesDoProf } = await supabase
      .from('modalidades')
      .select('nome')
      .eq('professor_id', professorId);

    const nomesMods = modalidadesDoProf ? modalidadesDoProf.map(m => m.nome.toLowerCase().trim()) : [];

    const aulasDoProfessor = aulas.filter(aula => {
      if (aula.professor_id === professorId) return true;

      if (!aula.professor_id && aula.atividade) {
        const nomeAtividade = aula.atividade.toLowerCase().trim();
        return nomesMods.includes(nomeAtividade);
      }

      return false;
    });

    return aulasDoProfessor;
  },

  async salvarAula(aula) {
    if (aula.id) {
      const { error } = await supabase.from('agenda').update(aula).eq('id', aula.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('agenda').insert([aula]);
      if (error) throw error;
    }
    return true;
  },

  async excluirAula(id) {
    const { error } = await supabase.from('agenda').delete().eq('id', id);
    if (error) throw error;
    return true;
  },

  async verificarDisponibilidade(aulaId, dataAula, alunoId = null) {
    try {
      const { data: aula } = await supabase
        .from('agenda')
        .select('capacidade, modalidades(nome, capacidade_padrao)')
        .eq('id', aulaId)
        .single();
        
      if (!aula) throw new Error("Aula não encontrada no banco.");

      const capacidadeMax = aula.modalidades?.capacidade_padrao || aula.capacidade || 15;
      const inicioDia = `${dataAula}T00:00:00`;
      const fimDia = `${dataAula}T23:59:59`;

      const [ { count: qtdAvulsos }, { data: fixos }, { data: excecoes } ] = await Promise.all([
        supabase.from('presencas').select('id', { count: 'exact' }).eq('aula_id', aulaId).gte('data_checkin', inicioDia).lte('data_checkin', fimDia),
        supabase.from('agenda_fixa').select('aluno_id').eq('aula_id', aulaId),
        supabase.from('agenda_excecoes').select('aluno_id, tipo').eq('aula_id', aulaId).eq('data_especifica', dataAula)
      ]);

      const ausenciasMap = new Set(excecoes?.filter(e => e.tipo === 'ausencia').map(e => e.aluno_id) || []);
      const qtdFixosAtivos = fixos?.filter(f => !ausenciasMap.has(f.aluno_id)).length || 0;

      const ocupacaoAtual = (qtdAvulsos || 0) + qtdFixosAtivos;
      let avisoLotacao = null;

      if (ocupacaoAtual >= capacidadeMax) {
        avisoLotacao = `Esta turma já está lotada! Capacidade máxima: ${capacidadeMax} vagas. Deseja forçar o agendamento mesmo assim?`;
      }

      let avisoLimitePlano = null;
      let limiteSemanal = 0;
      let usoSemanal = 0;
      let isLivre = false;
      const modNome = aula.modalidades?.nome || 'Atividade';

      if (alunoId) {
         const { data: aluno } = await supabase.from('alunos').select('modalidades_selecionadas, planos(nome)').eq('id', alunoId).single();
         if (aluno && aluno.planos) {
             isLivre = aluno.planos.nome.toLowerCase().includes('livre') || aluno.planos.nome.toLowerCase().includes('avulso');

             if (!isLivre && aluno.modalidades_selecionadas) {
                 if (modNome) {
                     limiteSemanal = aluno.modalidades_selecionadas.filter(m => m === modNome).length;

                     const dataBase = new Date(dataAula + 'T12:00:00');
                     const diaSemana = dataBase.getDay();
                     const diffInicio = dataBase.getDate() - diaSemana;
                     const diffFim = diffInicio + 6;
                     
                     const dataInicioSemana = new Date(dataBase.setDate(diffInicio)).toISOString().split('T')[0];
                     const dataFimSemana = new Date(dataBase.setDate(diffFim)).toISOString().split('T')[0];

                     const { data: agendamentosNaSemana } = await supabase
                        .from('presencas')
                        .select('aula_id')
                        .eq('aluno_id', alunoId)
                        .gte('data_checkin', `${dataInicioSemana}T00:00:00`)
                        .lte('data_checkin', `${dataFimSemana}T23:59:59`);
                     
                     const { data: fixasNaSemana } = await supabase
                        .from('agenda_fixa')
                        .select('aula_id')
                        .eq('aluno_id', alunoId);

                     usoSemanal = (agendamentosNaSemana?.length || 0) + (fixasNaSemana?.length || 0);

                     if (usoSemanal >= limiteSemanal && limiteSemanal > 0) {
                        avisoLimitePlano = `O aluno já atingiu ou ultrapassou o limite do plano para a modalidade ${modNome} (Limite: ${limiteSemanal}x na semana). Deseja agendar assim mesmo?`;
                     }
                 }
             }
         }
      }

      return {
        podeAgendarLivremente: !avisoLotacao && !avisoLimitePlano,
        avisoCritico: avisoLimitePlano || avisoLotacao,
        capacidadeMax,
        ocupacaoAtual,
        limiteSemanal,
        usoSemanal,
        isLivre,
        modNome
      };

    } catch (error) {
      console.error("Erro ao verificar capacidade:", error);
      return { podeAgendarLivremente: true, avisoCritico: null }; 
    }
  },

  async agendarAulaAdmin(dados) {
    if (!dados.ignorarAvisos) {
       const checagem = await this.verificarDisponibilidade(dados.aula_id, dados.data_aula, dados.aluno_id);
       if (!checagem.podeAgendarLivremente) {
          throw new Error(checagem.avisoCritico);
       }
    }

    const payload = {
      aula_id: dados.aula_id,
      data_checkin: `${dados.data_aula}T12:00:00`,
    };

    if (dados.tipo === 'visitante') {
      payload.nome_visitante = dados.nome_visitante;
      payload.aluno_id = null;
    } else {
      payload.aluno_id = dados.aluno_id;
      payload.nome_visitante = null;
    }

    const { error } = await supabase.from('presencas').insert([payload]);
    
    if (error && error.code === '23505') {
       throw new Error("Este aluno já possui um agendamento nesta mesma turma e mesma data.");
    } else if (error) {
       throw error;
    }
  },

  async cancelarAgendamento(id) {
    if (!id) {
      throw new Error("ID do agendamento não identificado pelo sistema.");
    }

    const { data, error } = await supabase
      .from('presencas')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error("O agendamento não foi encontrado no banco de dados para ser removido.");
    }

    return data;
  },

  async listarPresencasPeriodo(inicio, fim) {
    const { data, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_checkin,
        aula_id,
        nome_visitante,
        alunos ( id, nome_completo )
      `)
      .gte('data_checkin', `${inicio}T00:00:00`)
      .lte('data_checkin', `${fim}T23:59:59`);
    if (error) throw error;
    return data;
  },

  async listarPresencas(aulaId, dataAula) {
    const inicioDia = `${dataAula}T00:00:00`;
    const fimDia = `${dataAula}T23:59:59`;

    const { data, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_checkin, 
        alunos (
          id,
          nome_completo
        )
      `)
      .eq('aula_id', aulaId)
      .gte('data_checkin', inicioDia)
      .lte('data_checkin', fimDia);

    if (error) throw error;
    return data;
  },

  async listarFeriados() {
    const { data, error } = await supabase
      .from('feriados')
      .select('*')
      .gte('data', new Date().toISOString().split('T')[0]) 
      .order('data', { ascending: true });

    if (error) throw error;
    return data;
  },

  async cadastrarFeriado(feriado) {
    const { error } = await supabase.from('feriados').insert([feriado]);
    if (error) throw error;
    return true;
  },

  async excluirFeriado(id) {
    const { error } = await supabase.from('feriados').delete().eq('id', id);
    if (error) throw error;
    return true;
  },

  async listarMatriculasFixas() {
    const { data, error } = await supabase
      .from('agenda_fixa')
      .select(`
        aula_id,
        alunos ( id, nome_completo, data_inicio_plano, data_fim_plano )
      `);
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
           id_relacao: f.id,
           aluno_id: f.alunos.id,
           nome: f.alunos.nome_completo,
           tipo: 'fixo',
           status: excecoesMap.has(f.alunos.id) ? excecoesMap.get(f.alunos.id) : 'presente'
        });
      });
    }

    if (avulsos) {
      avulsos.forEach(a => {
        if (!a.nome_visitante && lista.find(l => l.aluno_id === a.alunos?.id)) return;
        
        lista.push({
           id_relacao: a.id,
           aluno_id: a.alunos?.id || null,
           nome: a.nome_visitante || a.alunos?.nome_completo,
           tipo: a.nome_visitante ? 'experimental' : 'avulso',
           status: 'presente'
        });
      });
    }
    return lista.sort((a,b) => a.nome.localeCompare(b.nome));
  },

  async registrarFalta(alunoId, aulaId, dataEspecifica) {
    const { error } = await supabase.from('agenda_excecoes').insert({
        aluno_id: alunoId,
        aula_id: aulaId,
        data_especifica: dataEspecifica,
        tipo: 'ausencia'
    });
    if (error) throw error;
  },

  async removerFalta(alunoId, aulaId, dataEspecifica) {
    const { error } = await supabase.from('agenda_excecoes')
        .delete()
        .match({ aluno_id: alunoId, aula_id: aulaId, data_especifica: dataEspecifica });
    if (error) throw error;
  }
};