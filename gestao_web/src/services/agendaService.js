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

  async agendarAulaAdmin({ aluno_id, aula_id, data_aula }) {
    const inicioDia = `${data_aula}T00:00:00`;
    const fimDia = `${data_aula}T23:59:59`;

    const { data: existente } = await supabase
      .from('presencas')
      .select('id')
      .eq('aluno_id', aluno_id)
      .eq('aula_id', aula_id)
      .gte('data_checkin', inicioDia)
      .lte('data_checkin', fimDia)
      .maybeSingle();

    if (existente) {
      throw new Error("Este aluno já está agendado nesta aula para esta data.");
    }

    const { data, error } = await supabase
      .from('presencas')
      .insert([{
        aluno_id: aluno_id,
        aula_id: aula_id,
        tipo: 'aula',
        data_checkin: `${data_aula}T12:00:00`,
        data_aula: data_aula
      }]);
    
    if (error) throw error;
    return data;
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

  async listarPresencasPeriodo(dataInicio, dataFim) {
    const inicioDia = `${dataInicio}T00:00:00`;
    const fimDia = `${dataFim}T23:59:59`;

    const { data, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_checkin,
        aula_id,
        alunos (nome_completo)
      `)
      .gte('data_checkin', inicioDia)
      .lte('data_checkin', fimDia);

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
      supabase.from('presencas').select('id, alunos(id, nome_completo)').eq('aula_id', aulaId).gte('data_checkin', inicioDia).lte('data_checkin', fimDia),
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
        if (!lista.find(l => l.aluno_id === a.alunos?.id)) {
          lista.push({
             id_relacao: a.id,
             aluno_id: a.alunos?.id,
             nome: a.alunos?.nome_completo,
             tipo: 'avulso',
             status: 'presente'
          });
        }
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