import { supabase } from '../lib/supabase';

export const agendaService = {
  // --- AULAS ---
  async listarGrade() {
    const { data, error } = await supabase
      .from('agenda')
      .select('*, alunos(nome_completo)') // Faz o join para trazer o nome do professor
      .order('horario', { ascending: true });
      
    if (error) throw error;
    return data;
  },

  async salvarAula(aula) {
    // Se tiver ID, é atualização
    if (aula.id) {
      const { error } = await supabase
        .from('agenda')
        .update(aula)
        .eq('id', aula.id);
      if (error) throw error;
    } else {
      // Se não, é inserção
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

  // --- FERIADOS ---
  async listarFeriados() {
    const { data, error } = await supabase
      .from('feriados')
      .select('*')
      .gte('data', new Date().toISOString().split('T')[0]) // Apenas feriados futuros ou hoje
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