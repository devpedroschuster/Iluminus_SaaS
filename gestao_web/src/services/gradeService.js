import { supabase } from '../lib/supabase';
import { hojeBrasilia } from '../lib/utils';

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

  /**
   * @param {'admin' | 'professor' | 'aluno'} perfil  — vem do useAuth
   * @param {string | null} professorId                — id do professor logado (se perfil === 'professor')
   */
  async listarGrade(perfil, professorId) {
    if (perfil === 'admin') {
      const { data, error } = await supabase
        .from('agenda')
        .select('*, professores(nome), modalidades(id, nome)')
        .order('horario', { ascending: true });
      if (error) throw error;
      return data;
    }

    if (perfil !== 'professor' || !professorId) return [];

    // Busca modalidades do professor e aulas em paralelo
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

    const vistas = new Set();
    return [...(aulasDiretas ?? []), ...(aulasPorMod ?? [])].filter((a) => {
      if (vistas.has(a.id)) return false;
      vistas.add(a.id);
      return true;
    });
  },

  async salvarAula(aula) {
    if (aula.id) {
      // ILU-18: mesmo padrão de alunosService.alterarStatus — sem
      // `.select()`, um `.update()` que afeta 0 linhas (RLS bloqueando
      // silenciosamente, id obsoleto etc.) retornava sucesso mesmo com a
      // aula nunca alterada de fato.
      const { data, error } = await supabase
        .from('agenda')
        .update(aula)
        .eq('id', aula.id)
        .select('id, horario')
        .single();
      if (error) throw error;
      // `horario` é `time without time zone` no Postgres — o PostgREST
      // devolve "HH:MM:SS" (com segundos), enquanto o formulário (input
      // type="time") manda "HH:MM" — por isso a comparação normaliza para
      // os 5 primeiros caracteres em vez de `!==` direto.
      if (data.horario?.substring(0, 5) !== aula.horario) {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
    } else {
      const { error } = await supabase.from('agenda').insert([aula]);
      if (error) throw error;
    }
    return true;
  },

  async excluirAula(id) {
    try {
      // ILU-23: cada passo da cascata precisa ter seu erro checado — antes
      // só o delete final em `agenda` era conferido, então um bloqueio de
      // RLS num passo anterior passava silenciosamente, podendo deixar
      // linhas órfãs ou só falhar mais tarde com um erro de FK sem indicar
      // qual passo realmente falhou.
      const { error: errFixa } = await supabase.from('agenda_fixa').delete().eq('aula_id', id);
      if (errFixa) throw errFixa;

      const { error: errExcecoes } = await supabase.from('agenda_excecoes').delete().eq('aula_id', id);
      if (errExcecoes) throw errExcecoes;

      // IMPORTANTE: não apagamos as presenças. O histórico de frequência do
      // aluno é dado real e deve sobreviver à exclusão da grade/aula — só
      // desvinculamos a referência (aula_id = null), preservando a linha.
      // Requer que presencas.aula_id aceite NULL e que a FK use
      // ON DELETE SET NULL (ver migration fix_presencas_old_fk.sql).
      const { error: errPresencas } = await supabase.from('presencas').update({ aula_id: null }).eq('aula_id', id);
      if (errPresencas) throw errPresencas;

      const { error } = await supabase.from('agenda').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Erro ao excluir aula em cascata:', error);
      throw error;
    }
  },

  async encerrarAula(id, dataEncerramento) {
    // ILU-18: mesmo padrão de alunosService.alterarStatus.
    const { data, error } = await supabase
      .from('agenda')
      .update({ data_fim: dataEncerramento })
      .eq('id', id)
      .select('id, data_fim')
      .single();
    if (error) throw error;
    if (data.data_fim !== dataEncerramento) {
      throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
    }
    return true;
  },

  async listarFeriados() {
    // ILU-19: hojeBrasilia() em vez de UTC.
    const { data, error } = await supabase
      .from('feriados')
      .select('*')
      .gte('data', hojeBrasilia())
      .order('data', { ascending: true });
    if (error) throw error;
    return data;
  },

  async cadastrarFeriado(dados) {
    const { error } = await supabase.from('feriados').insert([dados]);
    if (error) throw error;

    if (dados.bloqueia_agenda) {
      const inicioDia = `${dados.data}T00:00:00`;
      const fimDia    = `${dados.data}T23:59:59`;
      await supabase
        .from('presencas')
        .delete()
        .gte('data_checkin', inicioDia)
        .lte('data_checkin', fimDia);
    }
  },

  async listarMatriculasFixas(aulasIds = null) {
  let query = supabase
    .from('agenda_fixa')
    .select('aula_id, alunos (id, nome_completo, data_inicio_plano, data_fim_plano)');

  if (aulasIds !== null) {
    query = query.in('aula_id', aulasIds);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Erro ao buscar alunos fixos:', error);
    return [];
  }
  return data;
},
};