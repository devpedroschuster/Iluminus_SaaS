// src/services/alunosService.js
import { supabase } from '../lib/supabase';

export const alunosService = {
  /**
   * Lista alunos com filtros e joins
   */
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
      throw error; // Repassa o erro para o componente tratar com Toast
    }
  },

  /**
   * Cria um novo aluno/professor
   */
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

  /**
   * Exclui um aluno permanentemente do banco de dados
   */
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

  /**
   * Altera status de atividade (Ativo/Inativo)
   */
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

  /**
   * Deleta um registro
   */
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
  }
};