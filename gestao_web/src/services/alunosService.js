import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';

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

  async listarAtivos() {
    try {
      const { data, error } = await supabase
        .from('alunos')
        .select('id, nome_completo')
        .eq('ativo', true)
        .eq('role', 'aluno')
        .order('nome_completo');

      if (error) throw error;
      return data ?? [];
    } catch (error) {
      console.error('[alunosService.listarAtivos]', error);
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

  // ─────────────────────────────────────────────────────────────
  // BP-01 FIX: operações encadeadas substituídas por RPC atômica.
  // Todas as escritas ocorrem dentro de uma única transação
  // Postgres — se qualquer etapa falhar, o banco faz rollback
  // automático e nenhuma escrita parcial é persistida.
  //
  // REP-08 FIX (auditoria 2026-07): as RPCs `matricular_aluno` e
  // `renovar_plano_aluno` inserem a mensalidade diretamente via SQL
  // (frequentemente já como `status = 'pago'`, quando há valor pago
  // na hora da matrícula/renovação). Como esse INSERT não passa pelo
  // fluxo de `financeiroService` (adicionarPagamentoManual /
  // confirmarPagamento), a Edge Function `gerar-repasses` nunca era
  // chamada — resultado: aluno matriculado e pago, mas nenhum
  // lançamento em `repasses_lancamentos` para o professor.
  //
  // Correção: após a RPC concluir com sucesso, buscamos a mensalidade
  // recém-criada (aluno + data de início/pagamento) e, se ela já
  // nasceu paga, disparamos `gerarRepassesDaMensalidade` explicitamente,
  // com o mesmo tratamento de erro "não bloqueante" usado em
  // `adicionarPagamentoManual` (o pagamento/matrícula não é revertido
  // se o repasse falhar — apenas sinalizamos um aviso ao chamador).
  // ─────────────────────────────────────────────────────────────

  /**
   * Busca a mensalidade mais recente gerada para o aluno na data informada.
   * Usado logo após as RPCs de matrícula/renovação para localizar o registro
   * que precisa (ou não) disparar a geração de repasse.
   *
   * @param {string} alunoId
   * @param {string} dataReferencia - data no formato 'AAAA-MM-DD' (data_pagamento
   *                                   esperada da mensalidade recém-criada)
   */
  async _buscarMensalidadeRecente(alunoId, dataReferencia) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('id, status')
      .eq('aluno_id', alunoId)
      .eq('data_pagamento', dataReferencia)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[alunosService._buscarMensalidadeRecente] Falha ao localizar mensalidade.', error);
      return null;
    }
    return data;
  },

  /**
   * Dispara a geração de repasse para uma mensalidade recém-criada por RPC,
   * sem nunca lançar exceção para o chamador (a matrícula/renovação já foi
   * confirmada no banco — uma falha aqui só deve virar um aviso na UI).
   *
   * @param {string} alunoId
   * @param {string} dataReferencia
   * @param {number} valorPago
   * @returns {string|null} mensagem de aviso, ou null se tudo correu bem
   */
  async _dispararRepasseSeNecessario(alunoId, dataReferencia, valorPago) {
    if (!(Number(valorPago) > 0)) return null;

    const mensalidade = await this._buscarMensalidadeRecente(alunoId, dataReferencia);

    if (!mensalidade?.id) {
      console.warn('[alunosService] Mensalidade recém-criada não localizada; repasse não pôde ser verificado.');
      return 'Não foi possível localizar a mensalidade gerada para conferir o repasse. Verifique manualmente na aba "Reprocessar".';
    }

    if (mensalidade.status !== 'pago') {
      // Mensalidade ainda pendente: o repasse será disparado normalmente
      // quando o pagamento for confirmado via financeiroService.confirmarPagamento.
      return null;
    }

    try {
      await gerarRepassesDaMensalidade(mensalidade.id);
      return null;
    } catch (repasseError) {
      console.warn('[alunosService] Repasse não gerado automaticamente.', repasseError);
      return 'Concluído com sucesso, mas o repasse ao professor não pôde ser gerado automaticamente. Verifique manualmente na aba "Reprocessar".';
    }
  },

  /**
   * Renova o plano de um aluno de forma atômica via RPC.
   * Função SQL correspondente: renovar_plano_aluno()
   *
   * @returns {{ avisoRepasse: string|null }}
   */
  async renovarPlano(alunoId, dadosRenovacao) {
    try {
      const { error } = await supabase.rpc('renovar_plano_aluno', {
        p_aluno_id:    alunoId,
        p_plano_id:    dadosRenovacao.plano_id,
        p_data_inicio: dadosRenovacao.data_inicio,
        p_data_fim:    dadosRenovacao.data_fim,
        p_valor_pago:  dadosRenovacao.valor_pago ?? 0,
      });

      if (error) throw error;

      // REP-08 FIX: garante que o repasse seja gerado quando a renovação
      // já nasce como mensalidade paga.
      const avisoRepasse = await this._dispararRepasseSeNecessario(
        alunoId,
        dadosRenovacao.data_inicio,
        dadosRenovacao.valor_pago ?? 0,
      );

      return { sucesso: true, avisoRepasse };
    } catch (error) {
      console.error('[alunosService.renovarPlano]', error);
      throw error;
    }
  },

  /**
   * Matricula um aluno em um plano de forma atômica via RPC.
   * Função SQL correspondente: matricular_aluno()
   *
   * @param {string} alunoId
   * @param {string} planoId
   * @param {object} opcoes
   * @param {string}   opcoes.dataVencimento
   * @param {Array}    opcoes.modalidades
   * @returns {{ plano, dataInicio, dataFim, avisoRepasse: string|null }}
   */
  async matricular(alunoId, planoId, { dataVencimento, modalidades = [] }) {
    try {
      // Busca os dados do plano antes de iniciar a transação —
      // leitura pura, sem efeito colateral, portanto fora do RPC.
      const { data: plano, error: errPlano } = await supabase
        .from('planos')
        .select('id, nome, preco, duracao_meses')
        .eq('id', planoId)
        .single();

      if (errPlano) throw errPlano;

      const dataInicio = new Date().toISOString().split('T')[0];
      const dataFimObj = new Date(`${dataVencimento}T12:00:00`);
      dataFimObj.setMonth(dataFimObj.getMonth() + (plano.duracao_meses || 1));
      dataFimObj.setDate(dataFimObj.getDate() - 1);
      const dataFim = dataFimObj.toISOString().split('T')[0];

      const descricao = `Matrícula: ${plano.nome} (${plano.duracao_meses} ${
        plano.duracao_meses === 1 ? 'mês' : 'meses'
      })`;

      const { error } = await supabase.rpc('matricular_aluno', {
        p_aluno_id:    alunoId,
        p_plano_id:    planoId,
        p_data_inicio: dataInicio,
        p_data_fim:    dataFim,
        p_vencimento:  dataVencimento,
        p_modalidades: modalidades,
        p_valor_pago:  plano.preco ?? 0,
        p_descricao:   descricao,
      });

      if (error) throw error;

      // REP-08 FIX: garante que o repasse seja gerado quando a matrícula
      // já nasce como mensalidade paga (fluxo mais comum na recepção).
      const avisoRepasse = await this._dispararRepasseSeNecessario(
        alunoId,
        dataInicio,
        plano.preco ?? 0,
      );

      return { plano, dataInicio, dataFim, avisoRepasse };
    } catch (error) {
      console.error('[alunosService.matricular]', error);
      throw error;
    }
  },

  async normalizarHistoricoPlanos() {
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id, data_inicio_plano, data_fim_plano, created_at')
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;
    if (!alunos?.length) return { normalizados: 0, ignorados: 0 };

    const { data: historicosAtivos, error: errHistoricos } = await supabase
      .from('historico_planos')
      .select('aluno_id')
      .eq('status', 'ativo')
      .in('aluno_id', alunos.map(a => a.id));

    if (errHistoricos) throw errHistoricos;

    const comHistorico = new Set(historicosAtivos?.map(h => h.aluno_id));

    const hoje = new Date();
    const calcularDataFimFallback = () => {
      const fallback = new Date(hoje);
      fallback.setDate(fallback.getDate() + 30);
      return fallback.toISOString().split('T')[0];
    };

    const alunosSemHistorico = alunos.filter(a => !comHistorico.has(a.id));
    const ignorados = alunos.length - alunosSemHistorico.length;

    if (!alunosSemHistorico.length) {
      console.info('[normalizarHistoricoPlanos] Nenhum aluno sem histórico ativo.');
      return { normalizados: 0, ignorados };
    }

    const inserts = alunosSemHistorico.map(a => ({
      aluno_id:    a.id,
      plano_id:    a.plano_id,
      data_inicio: a.data_inicio_plano ?? a.created_at.split('T')[0],
      data_fim:    a.data_fim_plano    ?? calcularDataFimFallback(),
      status:      'ativo',
      valor_pago:  0,
    }));

    const { error: errInsert } = await supabase
      .from('historico_planos')
      .insert(inserts);

    if (errInsert) throw errInsert;

    const normalizados = inserts.length;
    console.info(
      `[normalizarHistoricoPlanos] Normalizados: ${normalizados}, Ignorados: ${ignorados}`
    );
    return { normalizados, ignorados };
  },
};