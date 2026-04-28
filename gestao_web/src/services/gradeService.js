import { supabase } from '../lib/supabase';

export const gradeService = {
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
      const { data: prof } = await supabase.from('professores').select('id').eq('auth_id', authId).maybeSingle();
      if (prof) professorId = prof.id;
    }

    if (!professorId) return aulas;

    const { data: modalidadesDoProf } = await supabase.from('modalidades').select('id').eq('professor_id', professorId);
    const idsModsDoProf = modalidadesDoProf ? modalidadesDoProf.map(m => m.id) : [];

    return aulas.filter(aula => {
      if (aula.professor_id === professorId) return true;
      if (!aula.professor_id && aula.modalidade_id && idsModsDoProf.includes(aula.modalidade_id)) return true;
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
    // 🔥 CORREÇÃO: Usando alunos(*) evitamos o erro 400 de coluna não encontrada!
    const { data, error } = await supabase.from('agenda_fixa').select('aula_id, alunos (*)');
    if (error) {
      console.error("Erro ao buscar alunos fixos:", error);
      return [];
    }
    return data;
  }
};