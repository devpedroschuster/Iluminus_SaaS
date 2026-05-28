import { supabase } from '../lib/supabase';

export const alunosService = {
  async listar(filtros = {}, paginacao = {}) {
    try {
      const { pagina = 1, tamanho = 25 } = paginacao;
      const inicio = (pagina - 1) * tamanho;
      const fim    = inicio + tamanho - 1;

      let query = supabase
        .from('alunos')
        .select('*, planos(nome)', { count: 'exact' });

      if (filtros.role && filtros.role !== 'todos')
        query = query.eq('role', filtros.role);

      if (filtros.busca)
        query = query.or(`nome_completo.ilike.%${filtros.busca}%,email.ilike.%${filtros.busca}%`);

      if (filtros.letraInicial)
        query = query.ilike('nome_completo', `${filtros.letraInicial}%`);

      const { data, error, count } = await query
        .order('nome_completo')
        .range(inicio, fim);

      if (error) throw error;
      return { data, count };
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
          status: 'ativo',
        }]);

      if (errHist) throw errHist;

      const { error: errAluno } = await supabase
        .from('alunos')
        .update({
          plano_id: dadosRenovacao.plano_id,
          data_fim_plano: dadosRenovacao.data_fim,
        })
        .eq('id', alunoId);

      if (errAluno) throw errAluno;

      const { error: errMensalidade } = await supabase
        .from('mensalidades')
        .insert([{
          aluno_id: alunoId,
          plano_id: dadosRenovacao.plano_id,
          data_vencimento: dadosRenovacao.data_inicio,
          status: 'pendente',
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
   * deve delegar aqui, nunca inserir em historico_planos diretamente.
   *
   * FIX Bug 2: inserção em historico_planos é sempre feita, sem guard condicional.
   * Para simples atualização de dados sem novo ciclo, use alunosService.atualizar().
   *
   * @param {string} alunoId
   * @param {string} planoId
   * @param {object} opcoes
   * @param {string}   opcoes.dataVencimento
   * @param {Array}    opcoes.modalidades
   */
  async matricular(alunoId, planoId, { dataVencimento, modalidades = [] }) {
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

      // 1. Atualiza o cadastro do aluno
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

      // 2. Finaliza ciclo anterior (se houver) antes de criar o novo
      await supabase
        .from('historico_planos')
        .update({ status: 'finalizado' })
        .eq('aluno_id', alunoId)
        .eq('status', 'ativo');

      // 3. Insere SEMPRE em historico_planos — sem guard condicional
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

      // 4. Cria a mensalidade
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

  /**
   * Migration helper — normaliza registros existentes que possuem plano_id
   * mas não têm entrada correspondente em historico_planos.
   * Executar uma única vez via painel admin ou script de migração.
   */
  async normalizarHistoricoPlanos() {
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id, data_inicio_plano, data_fim_plano, created_at')
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;

    let normalizados = 0;
    let ignorados = 0;

    for (const aluno of alunos) {
      const { data: historico } = await supabase
        .from('historico_planos')
        .select('id')
        .eq('aluno_id', aluno.id)
        .eq('status', 'ativo')
        .maybeSingle();

      if (historico) { ignorados++; continue; }

      const dataInicio = aluno.data_inicio_plano ?? aluno.created_at.split('T')[0];
      let dataFim = aluno.data_fim_plano;
      if (!dataFim) {
        const fallback = new Date();
        fallback.setDate(fallback.getDate() + 30);
        dataFim = fallback.toISOString().split('T')[0];
      }

      const { error: errInsert } = await supabase
        .from('historico_planos')
        .insert([{
          aluno_id: aluno.id,
          plano_id: aluno.plano_id,
          data_inicio: dataInicio,
          data_fim: dataFim,
          status: 'ativo',
          valor_pago: 0,
        }]);

      if (errInsert) {
        console.warn(`[normalizarHistoricoPlanos] Falha no aluno ${aluno.id}:`, errInsert);
        ignorados++;
      } else {
        normalizados++;
      }
    }

    console.info(`[normalizarHistoricoPlanos] Normalizados: ${normalizados}, Ignorados: ${ignorados}`);
    return { normalizados, ignorados };
  },
};