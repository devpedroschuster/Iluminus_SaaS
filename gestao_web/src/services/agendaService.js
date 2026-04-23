import { supabase } from '../lib/supabase';

export const agendaService = {
  async listarProfessores() {
    const { data, error } = await supabase.from('professores').select('*').eq('ativo', true).order('nome');
    if (error) throw error;
    return data;
  },

  async listarModalidades() {
    const { data, error } = await supabase.from('modalidades').select('*').order('nome');
    if (error) throw error;
    return data;
  },

  async listarGrade() {
    const { data: { session } } = await supabase.auth.getSession();
    const authId = session?.user?.id;
    
    const userRole = session?.user?.user_metadata?.role;

    const { data: aulas, error } = await supabase
      .from('agenda')
      .select('*, professores(nome)')
      .order('horario', { ascending: true });
      
    if (error) throw error;

    if (userRole === 'admin') return aulas;

    let professorId = null;
    if (authId) {
      const { data: prof } = await supabase
        .from('professores')
        .select('id')
        .eq('auth_id', authId)
        .maybeSingle();
        
      if (prof) professorId = prof.id;
    }

    if (!professorId) return aulas;

    const { data: modalidadesDoProf } = await supabase
      .from('modalidades')
      .select('id')
      .eq('professor_id', professorId);
      
    const idsModsDoProf = modalidadesDoProf ? modalidadesDoProf.map(m => m.id) : [];

    return aulas.filter(aula => {
      if (aula.professor_id === professorId) return true;
      
      if (!aula.professor_id && aula.modalidade_id && idsModsDoProf.includes(aula.modalidade_id)) {
        return true;
      }
      
      return false;
    });
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
        .select('capacidade, modalidades(id, nome, area, capacidade_padrao)')
        .eq('id', aulaId)
        .single();
        
      if (!aula) throw new Error("Aula não encontrada no banco.");

      const capacidadeMax = aula.modalidades?.capacidade_padrao || aula.capacidade || 15;
      const modId = aula.modalidades?.id;
      const modNome = aula.modalidades?.nome || 'Atividade';
      const modArea = aula.modalidades?.area;

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
      let temModalidadeNoPlano = true;

      if (alunoId) {
         // BUSCAMOS AS REGRAS E O ARRAY DE UUIDS
         const { data: aluno } = await supabase.from('alunos').select('modalidades_selecionadas, planos(nome, regras_acesso)').eq('id', alunoId).single();
         
         if (aluno && aluno.planos) {
             const regrasPlano = aluno.planos.regras_acesso || [];
             const regraDaArea = regrasPlano.find(r => r.modalidade === modArea);

             if (!regraDaArea) {
                 avisoLimitePlano = `Atenção: O plano atual do aluno NÃO permite acesso à área de "${modArea}". Deseja forçar a entrada mesmo assim?`;
                 temModalidadeNoPlano = false;
             } else {
                 isLivre = regraDaArea.limite === 999;
                 const selectedModsIds = aluno.modalidades_selecionadas || [];

                 // MUDANÇA AQUI: O limite agora vem 100% da regra do Plano, ignorando os "cliques" no perfil
                 limiteSemanal = regraDaArea.limite;

                 // Exige apenas que a modalidade esteja presente ao menos 1 vez no perfil
                 if (!isLivre && !selectedModsIds.includes(modId)) {
                     avisoLimitePlano = `Atenção: O aluno não possui a modalidade "${modNome}" ativa no perfil dele. Deseja forçar?`;
                     temModalidadeNoPlano = false;
                 } else if (!isLivre) {
                     // Calcula quantas vezes ele já fez AULAS DESTA ÁREA na semana
                     const dataBase = new Date(dataAula + 'T12:00:00');
                     const diaSemana = dataBase.getDay();
                     const diffInicio = dataBase.getDate() - diaSemana;
                     const diffFim = diffInicio + 6;
                     
                     const dataInicioSemana = new Date(dataBase.setDate(diffInicio)).toISOString().split('T')[0];
                     const dataFimSemana = new Date(dataBase.setDate(diffFim)).toISOString().split('T')[0];

                     // Busca todas as presenças da semana puxando a Área junto
                     const { data: agendamentosNaSemana } = await supabase
                        .from('presencas')
                        .select('aula_id, agenda(modalidades(area))')
                        .eq('aluno_id', alunoId)
                        .gte('data_checkin', `${dataInicioSemana}T00:00:00`)
                        .lte('data_checkin', `${dataFimSemana}T23:59:59`);
                     
                     const { data: fixasNaSemana } = await supabase
                        .from('agenda_fixa')
                        .select('aula_id, agenda(modalidades(area))')
                        .eq('aluno_id', alunoId);

                     // Filtra apenas as que pertencem à mesma ÁREA (Ex: Funcional)
                     const qtdAgendados = agendamentosNaSemana?.filter(p => p.agenda?.modalidades?.area === modArea).length || 0;
                     const qtdFixos = fixasNaSemana?.filter(f => f.agenda?.modalidades?.area === modArea).length || 0;

                     usoSemanal = qtdAgendados + qtdFixos;

                     if (usoSemanal >= limiteSemanal && limiteSemanal > 0) {
                        avisoLimitePlano = `O aluno já atingiu o limite de ${limiteSemanal}x aulas na semana para a área de ${modArea}. Deseja agendar assim mesmo?`;
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
        modNome,
        temModalidadeNoPlano 
      };

    } catch (error) {
      console.error(error);
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

  async listarFeriados() {
    const { data, error } = await supabase.from('feriados').select('*').gte('data', new Date().toISOString().split('T')[0]).order('data', { ascending: true });
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
    const { data, error } = await supabase.from('agenda_fixa').select('aula_id, alunos ( id, nome_completo, data_inicio_plano, data_fim_plano )');
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