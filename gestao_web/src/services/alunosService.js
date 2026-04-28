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

     async listarAniversariantes() {
    const { data, error } = await supabase
      .from('alunos')
      .select('id, nome_completo, data_nascimento, telefone, planos(nome)')
      .not('data_nascimento', 'is', null);

    if (error) throw error;
    return data;
  },

async buscarPerfilCompleto(alunoId) {
    const { data, error } = await supabase
      .from('alunos')
      .select(`
        *,
        planos (nome, regras_acesso)
      `)
      .eq('id', alunoId)
      .single();
    
    if (error) throw error;
    return data;
  },

  async buscarHistoricoPlanos(alunoId) {
    const { data, error } = await supabase
      .from('historico_planos')
      .select(`
        *,
        planos (nome, regras_acesso)
      `)
      .eq('aluno_id', alunoId)
      .order('data_inicio', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async buscarHistoricoFrequencia(alunoId) {
    const { data, error } = await supabase
      .from('presencas')
      .select(`
        *,
        agenda (atividade)
      `)
      .eq('aluno_id', alunoId)
      .order('data_checkin', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async renovarPlano(alunoId, dadosRenovacao) {
    try {
      await supabase
        .from('historico_planos')
        .update({ status: 'finalizado' })
        .eq('aluno_id', alunoId)
        .eq('status', 'ativo');

      const { error: errHist } = await supabase
        .from('historico_planos')
        .insert([{
          aluno_id: alunoId,
          plano_id: dadosRenovacao.plano_id,
          data_inicio: dadosRenovacao.data_inicio,
          data_fim: dadosRenovacao.data_fim,
          valor_pago: dadosRenovacao.valor_pago || 0,
          status: 'ativo'
        }]);
      
      if (errHist) throw errHist;

      const { error: errAluno } = await supabase
        .from('alunos')
        .update({
          plano_id: dadosRenovacao.plano_id,
          data_vencimento: dadosRenovacao.data_fim
        })
        .eq('id', alunoId);

      if (errAluno) throw errAluno;

      return true;
    } catch (error) {
      console.error('Erro ao renovar plano:', error);
      throw error;
    }
  }
};