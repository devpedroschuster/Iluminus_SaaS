// src/services/alunosService.js
import { supabase } from '../lib/supabase';

export const alunosService = {
  async listar(filtros = {}) {
    try {
      let query = supabase
        .from('alunos')
        .select('*, planos(nome, preco)')
        .order('nome_completo');

      if (filtros.role && filtros.role !== 'todos') {
        query = query.eq('role', filtros.role);
      }

      if (filtros.busca) {
        query = query.ilike('nome_completo', `%${filtros.busca}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[alunosService.listar]', error);
      throw error;
    }
  },

    async criar(dados) {
    try {
      const { data, error } = await supabase
        .from('alunos')
        .insert([dados])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[alunosService.criar]', error);
      throw error;
    }
  },

  async atualizar(id, dados) {
    try {
      const { data, error } = await supabase
        .from('alunos')
        .update(dados)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[alunosService.atualizar]', error);
      throw error;
    }
  },

    async excluir(id) {
    try {
      const { error } = await supabase
        .from('alunos')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('[alunosService.excluir]', error);
      throw error;
    }
  },

    async alterarStatus(id, novoStatus) {
    try {
      const { error } = await supabase
        .from('alunos')
        .update({ ativo: novoStatus })
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('[alunosService.alterarStatus]', error);
      throw error;
    }
  },

   async deletar(id) {
    try {
      const { error } = await supabase
        .from('alunos')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('[alunosService.deletar]', error);
      throw error;
    }
  },

  async listarAniversariantes() {
    const { data, error } = await supabase
      .from('alunos')
      .select('id, nome_completo, data_nascimento, telefone, planos(nome)')
      .not('data_nascimento', 'is', null);

    if (error) throw error;
    return data;
  },
};