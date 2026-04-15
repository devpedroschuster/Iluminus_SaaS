import { supabase } from '../lib/supabase';

export const modalidadeService = {
  async listar() {
    const { data, error } = await supabase
      .from('modalidades')
      .select('*, professores (nome)')
      .order('nome');
    if (error) throw error;
    return data;
  },

  async buscarPerfil(id, nome) {
    const { data: horarios, error: errHorarios } = await supabase
      .from('agenda')
      .select('dia_semana, horario')
      .eq('modalidade_id', id)
      .eq('eh_recorrente', true)
      .order('dia_semana')
      .order('horario');
      
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, nome_completo, planos(nome)')
      .eq('ativo', true)
      .contains('modalidades_selecionadas', [nome])
      .order('nome_completo');

    return {
      horarios: horarios || [],
      alunos: alunos || []
    };
  },

  async salvar(modalidade) {
    const payload = {
      nome: modalidade.nome,
      professor_id: modalidade.professor_id || null,
      taxa_professor: Number(modalidade.taxa_professor) || 0,
      taxa_espaco: Number(modalidade.taxa_espaco) || 0,
      taxa_direcao: Number(modalidade.taxa_direcao) || 0,
      capacidade_padrao: modalidade.capacidade_padrao
    };

    if (modalidade.id) {
      const { error } = await supabase.from('modalidades').update(payload).eq('id', modalidade.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('modalidades').insert([payload]);
      if (error) throw error;
    }
    return true;
  },

  async excluir(id) {
    const { error } = await supabase.from('modalidades').delete().eq('id', id);
    if (error) throw error;
    return true;
  }
};