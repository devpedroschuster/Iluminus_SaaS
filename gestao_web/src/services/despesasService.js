import { supabase } from '../lib/supabase';

export const despesasService = {
  async listar(mes, ano) {
    const dataInicio = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
    const dataFim    = new Date(ano, mes, 0).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('despesas')
      .select('*')
      .gte('data_vencimento', dataInicio)
      .lte('data_vencimento', dataFim)
      .order('data_vencimento', { ascending: false });

    if (error) throw error;

    const hoje = new Date().toISOString().split('T')[0];
    const despesasAtualizadas = data.map(d => {
      if (d.status === 'pendente' && d.data_vencimento < hoje) {
        return { ...d, status: 'atrasado' };
      }
      return d;
    });

    return despesasAtualizadas;
  },

  /**
   * Replica despesas recorrentes do mês anterior para o mês atual,
   * caso ainda não existam. Deve ser chamado ao carregar o módulo de Despesas.
   *
   * @param {number} mes - Mês 1-indexed (1 = janeiro, 12 = dezembro).
   * @param {number} ano - Ano com 4 dígitos (ex: 2025).
   * @returns {number} Quantidade de despesas replicadas.
   */
  async replicarRecorrentes(mes, ano) {
    // Calcular mês anterior (1-indexed)
    const mesAnterior = mes === 1 ? 12 : mes - 1;
    const anoAnterior = mes === 1 ? ano - 1 : ano;

    // Buscar despesas recorrentes do mês anterior
    const dataInicioAnt = new Date(anoAnterior, mesAnterior - 1, 1).toISOString().split('T')[0];
    const dataFimAnt    = new Date(anoAnterior, mesAnterior, 0).toISOString().split('T')[0];

    const { data: recorrentes, error: errBusca } = await supabase
      .from('despesas')
      .select('*')
      .gte('data_vencimento', dataInicioAnt)
      .lte('data_vencimento', dataFimAnt)
      .eq('recorrente', true);

    if (errBusca) throw errBusca;
    if (!recorrentes || recorrentes.length === 0) return 0;

    // Buscar recorrentes já existentes no mês atual para evitar duplicatas
    const dataInicioAtual = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
    const dataFimAtual    = new Date(ano, mes, 0).toISOString().split('T')[0];

    const { data: existentes } = await supabase
      .from('despesas')
      .select('descricao, categoria')
      .gte('data_vencimento', dataInicioAtual)
      .lte('data_vencimento', dataFimAtual)
      .eq('recorrente', true);

    const chaveExistente = new Set(
      (existentes || []).map(d => `${d.descricao}|${d.categoria}`)
    );

    // Montar novas despesas avançando a data de vencimento para o mês atual
    const novas = recorrentes
      .filter(d => !chaveExistente.has(`${d.descricao}|${d.categoria}`))
      .map(({ id, created_at, data_pagamento, status, ...rest }) => {
        const dataOriginal = new Date(rest.data_vencimento + 'T12:00:00');
        const novaData = new Date(ano, mes - 1, dataOriginal.getDate());

        // Ajuste para meses mais curtos (ex: dia 31 em fevereiro → dia 28/29)
        if (novaData.getMonth() !== mes - 1) {
          novaData.setDate(0); // recua para o último dia do mês correto
        }

        return {
          ...rest,
          data_vencimento: novaData.toISOString().split('T')[0],
          status: 'pendente',       // sempre inicia pendente no novo mês
          data_pagamento: null,
        };
      });

    if (novas.length === 0) return 0;

    const { error: errInsert } = await supabase
      .from('despesas')
      .insert(novas);

    if (errInsert) throw errInsert;
    return novas.length;
  },

  async salvar(despesa) {
    const payload = { ...despesa };

    if (!payload.id) {
      delete payload.id;
    }

    if (despesa.id) {
      const { data, error } = await supabase
        .from('despesas')
        .update(payload)
        .eq('id', despesa.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('despesas')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  async excluir(id) {
    const { error } = await supabase
      .from('despesas')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  async registrarPagamento(id) {
    const hoje = new Date().toISOString();
    const { error } = await supabase
      .from('despesas')
      .update({ status: 'pago', data_pagamento: hoje })
      .eq('id', id);

    if (error) throw error;
    return true;
  }
};