import { supabase } from '../lib/supabase';

export const agendaService = {
  // --- AULAS ---
  async listarGrade() {
    const { data, error } = await supabase
      .from('agenda')
      .select('*, alunos(nome_completo)') 
      .order('horario', { ascending: true });
      
    if (error) throw error;
    return data;
  },

  async salvarAula(aula) {
    if (aula.id) {
      const { error } = await supabase
        .from('agenda')
        .update(aula)
        .eq('id', aula.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('agenda')
        .insert([aula]);
      if (error) throw error;
    }
    return true;
  },

  async excluirAula(id) {
    const { error } = await supabase
      .from('agenda')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  // AGENDAMENTO MANUAL PELA RECEPÇÃO
  async agendarAulaAdmin({ aluno_id, aula_id, data_aula }) {
    const { data, error } = await supabase.rpc('agendar_aula', {
      p_aluno_id: aluno_id,
      p_aula_id: aula_id,
      p_data: data_aula
    });
    
    if (error) throw error;
    return data;
  },

  // CANCELAR AGENDAMENTTO
  async cancelarAgendamento({ aluno_id, aula_id, data_aula }) {
    const { data, error } = await supabase.rpc('cancelar_agendamento', {
      p_aluno_id: aluno_id,
      p_aula_id: aula_id,
      p_data: data_aula
    });
    
    if (error) throw error;
    return data;
  },

  // LISTAR PRESENÇAS DE UMA AULA ESPECÍFICA
  async listarPresencas(aulaId, dataAula) {
    const { data, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_aula,
        alunos (
          id,
          nome_completo
        )
      `)
      .eq('aula_id', aulaId)
      .eq('data_aula', dataAula);

    if (error) {
        throw error;
    }
    
    return data;
  },

  // FERIADOS
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
    const { error } = await supabase
      .from('feriados')
      .insert([feriado]);
    if (error) throw error;
    return true;
  },

  async excluirFeriado(id) {
    const { error } = await supabase
      .from('feriados')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  }
};