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
  query = query.or(
    `nome_completo.ilike.%${filtros.busca}%,email.ilike.%${filtros.busca}%`
  );
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
          data_fim_plano: dadosRenovacao.data_fim
        })
        .eq('id', alunoId);

      if (errAluno) throw errAluno;

      const { error: errMensalidade } = await supabase
        .from('mensalidades')
        .insert([{
          aluno_id: alunoId,
          plano_id: dadosRenovacao.plano_id,
          data_vencimento: dadosRenovacao.data_inicio,
          status: 'pendente'
        }]);

      if (errMensalidade) throw errMensalidade;

      return true;
    } catch (error) {
      console.error('[alunosService.renovarPlano]', error);
      throw error;
    }
  },

  /**
   * Matricula um aluno em um plano de forma canônica.
   * Deve ser o único ponto de entrada para matrícula — substitui a lógica
   * duplicada de salvarEtapa2 (NovoAluno.jsx) e handleMatricular (ModalMatricula.jsx).
   *
   * @param {string} alunoId
   * @param {string} planoId
   * @param {object} opcoes
   * @param {string}   opcoes.dataVencimento
   * @param {Array}    opcoes.modalidades
   * @param {boolean} [opcoes.isNovaMatricula]
   */
  async matricular(alunoId, planoId, { dataVencimento, modalidades = [], isNovaMatricula = true }) {
    try {
      const { data: plano, error: errPlano } = await supabase
        .from('planos')
        .select('id, nome, preco, duracao_meses')
        .eq('id', planoId)
        .single();

      if (errPlano) throw errPlano;

      const dataInicio = new Date().toISOString().split('T')[0];
      const dataFimObj = new Date(dataVencimento + 'T12:00:00');
      dataFimObj.setMonth(dataFimObj.getMonth() + (plano.duracao_meses || 1));
      dataFimObj.setDate(dataFimObj.getDate() - 1);
      const dataFim = dataFimObj.toISOString().split('T')[0];

      const { error: errAluno } = await supabase
        .from('alunos')
        .update({
          plano_id: planoId,
          modalidades_selecionadas: modalidades,
          ativo: 'true',
          data_inicio_plano: dataInicio,
          data_fim_plano: dataFim,
        })
        .eq('id', alunoId);

      if (errAluno) throw errAluno;

      if (isNovaMatricula) {
        const { error: errHist } = await supabase
          .from('historico_planos')
          .insert([{
            aluno_id: alunoId,
            plano_id: planoId,
            data_inicio: dataInicio,
            data_fim: dataFim,
            status: 'ativo',
            valor_pago: plano.preco || 0,
          }]);

        if (errHist) throw errHist;
      }

      const { error: errMens } = await supabase
        .from('mensalidades')
        .insert([{
          aluno_id: alunoId,
          plano_id: planoId,
          data_vencimento: dataVencimento,
          status: 'pendente',
          descricao: `Matrícula: ${plano.nome} (${plano.duracao_meses} ${plano.duracao_meses === 1 ? 'mês' : 'meses'})`,
        }]);

      if (errMens) throw errMens;

      return { plano, dataInicio, dataFim };
    } catch (error) {
      console.error('[alunosService.matricular]', error);
      throw error;
    }
  },
};