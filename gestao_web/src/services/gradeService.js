import { supabase } from '../lib/supabase';

export const gradeService = {
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
    const authId = session?.user?.id;
    const email = session?.user?.email;

    if (!authId) return [];

    const { data: usuarioAluno } = await supabase
      .from('alunos')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();

    const { data: usuarioProf } = await supabase
      .from('professores')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    const isAdmin =
      (usuarioAluno?.role === 'admin') ||
      (!usuarioAluno && !usuarioProf);

    if (!isAdmin) {
      if (!usuarioProf) return [];

      const professorId = usuarioProf.id;

      const { data: modalidadesDoProf } = await supabase
        .from('modalidades')
        .select('id')
        .eq('professor_id', professorId);

      const idsModsDoProf = modalidadesDoProf?.map((m) => m.id) ?? [];

      const [{ data: aulasDiretas, error: errDiretas }, { data: aulasPorMod, error: errMod }] =
        await Promise.all([
          supabase
            .from('agenda')
            .select('*, professores(nome), modalidades(id, nome)')
            .eq('professor_id', professorId)
            .order('horario', { ascending: true }),

          idsModsDoProf.length > 0
            ? supabase
                .from('agenda')
                .select('*, professores(nome), modalidades(id, nome)')
                .is('professor_id', null)
                .in('modalidade_id', idsModsDoProf)
                .order('horario', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (errDiretas) throw errDiretas;
      if (errMod) throw errMod;

      const todas = [...(aulasDiretas ?? []), ...(aulasPorMod ?? [])];
      const vistas = new Set();
      return todas.filter((a) => {
        if (vistas.has(a.id)) return false;
        vistas.add(a.id);
        return true;
      });
    }

    const { data: aulas, error } = await supabase
      .from('agenda')
      .select('*, professores(nome), modalidades(id, nome)')
      .order('horario', { ascending: true });
    if (error) throw error;
    return aulas;
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
    try {
      await supabase.from('agenda_fixa').delete().eq('aula_id', id);
      await supabase.from('agenda_excecoes').delete().eq('aula_id', id);
      await supabase.from('presencas').delete().eq('aula_id', id);
      const { error } = await supabase.from('agenda').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Erro ao excluir aula em cascata:', error);
      throw error;
    }
  },

  async encerrarAula(id, dataEncerramento) {
    const { error } = await supabase
      .from('agenda')
      .update({ data_fim: dataEncerramento })
      .eq('id', id);
    if (error) throw error;
    return true;
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
      .select('aula_id, alunos (*)');
    if (error) {
      console.error('Erro ao buscar alunos fixos:', error);
      return [];
    }
    return data;
  },
};