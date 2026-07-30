import { supabase } from '../lib/supabase';

export const comissoesService = {
  async listarProfessores() {
    const { data, error } = await supabase
      .from('professores')
      .select('*')
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;
    return data;
  },

  async buscarDetalhes(professorId, mesAno) {
    const inicio = `${mesAno}-01`;
    const [ano, mes] = mesAno.split('-').map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesAno}-${String(ultimoDia).padStart(2, '0')}`;

    const { data: fechamento } = await supabase
      .from('fechamento_comissoes')
      .select('*')
      .eq('professor_id', professorId)
      .eq('mes_referencia', `${mesAno}-01`)
      .maybeSingle();

    const { data: lancamentos, error } = await supabase
      .from('repasses_lancamentos')
      .select('id, valor, tipo_aula, modalidade, data_referencia, pago_em, status, alunos(nome_completo)')
      .eq('professor_id', professorId)
      .gte('data_referencia', inicio)
      .lte('data_referencia', fim)
      .order('data_referencia', { ascending: false });

    if (error) throw error;

    const total = (lancamentos || []).reduce((s, l) => s + Number(l.valor), 0);

    const porTipo = (lancamentos || []).reduce((acc, l) => {
      acc[l.tipo_aula] = (acc[l.tipo_aula] || 0) + Number(l.valor);
      return acc;
    }, {});

    return {
      fechamento,
      professor_id: professorId,
      mes: mesAno,
      resumo: { total_comissao: total },
      porTipo,
      lancamentos: lancamentos || [],
    };
  },

  // UX-04: resumo consolidado de todos os professores para um mês.
  async resumoMensal(mesAno) {
    const inicio = `${mesAno}-01`;
    const [ano, mes] = mesAno.split('-').map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesAno}-${String(ultimoDia).padStart(2, '0')}`;

    const { data: lancamentos, error } = await supabase
      .from('repasses_lancamentos')
      .select('professor_id, valor, tipo_aula, status, professores(id, nome)')
      .gte('data_referencia', inicio)
      .lte('data_referencia', fim);

    if (error) throw error;

    const { data: fechamentos } = await supabase
      .from('fechamento_comissoes')
      .select('professor_id, valor_total, fechado_em')
      .eq('mes_referencia', `${mesAno}-01`);

    const fechamentosPorProf = new Map(
      (fechamentos || []).map(f => [f.professor_id, f])
    );

    const porProf = new Map();
    for (const l of lancamentos || []) {
      if (!l.professor_id) continue;
      if (!porProf.has(l.professor_id)) {
        porProf.set(l.professor_id, {
          professor_id: l.professor_id,
          nome: l.professores?.nome ?? 'Professor',
          total: 0,
          pendente: 0,
          pago: 0,
          qtd: 0,
          porTipo: {},
          fechamento: fechamentosPorProf.get(l.professor_id) ?? null,
        });
      }
      const entry = porProf.get(l.professor_id);
      const valor = Number(l.valor);
      entry.total += valor;
      entry.qtd += 1;
      if (l.status === 'pago') {
        entry.pago += valor;
      } else {
        entry.pendente += valor;
      }
      entry.porTipo[l.tipo_aula] = (entry.porTipo[l.tipo_aula] || 0) + valor;
    }

    return [...porProf.values()].sort((a, b) => b.total - a.total);
  },

  /**
   * REP-04 / SEC-02 FIX (auditoria 2026-07): antes, `valorTotal` era calculado
   * no client (`useMemo` em Comissoes.jsx) e enviado como está para o banco via
   * upsert. Isso permitia fechar um mês com um valor diferente da soma real dos
   * lançamentos (bug de UI, filtro aplicado sem querer, ou manipulação direta),
   * sem nenhuma verificação. Além disso o `upsert` permitia sobrescrever
   * silenciosamente um mês já fechado, sem trilha de auditoria da mudança.
   *
   * Agora a assinatura não recebe mais `valorTotal`: o valor é recalculado a
   * partir de `repasses_lancamentos` dentro da função/RPC `fechar_comissao_mes`
   * no banco, que também deve:
   *   1) verificar se já existe fechamento para (professor_id, mes_referencia)
   *      e recusar um re-fechamento silencioso (ou registrar a alteração);
   *   2) rodar em transação para evitar condição de corrida com inserts
   *      concorrentes de novos lançamentos no mesmo período.
   *
   * @param {string} professorId
   * @param {string} mesAno - formato 'YYYY-MM'
   * @returns {{ valor_total: number, fechado_em: string }}
   */
  async fecharMes(professorId, mesAno) {
    const { data, error } = await supabase.rpc('fechar_comissao_mes', {
      p_professor_id: professorId,
      p_mes_referencia: `${mesAno}-01`,
    });

    if (error) throw error;
    return data;
  },

  /**
   * SEC-01 FIX (auditoria 2026-07): verifica no banco — e não apenas
   * confiando na UI — se o mês de referência de um lançamento já foi
   * fechado para o professor. Antes, `updateLancamento`/`deleteLancamento`
   * só eram bloqueados pela ocultação dos botões de edição/exclusão na
   * tela (`{!fechado && (...)}`); qualquer chamada direta ao Supabase
   * (console do navegador, script, etc.) conseguia alterar ou apagar
   * lançamentos de um mês já fechado e auditado, corrompendo o
   * histórico financeiro.
   *
   * @param {string} professorId
   * @param {string} dataReferencia - 'AAAA-MM-DD' do lançamento
   * @returns {boolean}
   */
  async _mesEstaFechado(professorId, dataReferencia) {
    const mesReferencia = `${String(dataReferencia).substring(0, 7)}-01`;

    const { data, error } = await supabase
      .from('fechamento_comissoes')
      .select('id')
      .eq('professor_id', professorId)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();

    if (error) {
      console.error('[comissoesService._mesEstaFechado]', error);
      // Em caso de falha na checagem, é mais seguro bloquear a operação
      // do que permitir uma edição/exclusão indevida.
      throw new Error('Não foi possível verificar o status do mês. Tente novamente.');
    }

    return !!data;
  },

  // EDIT-01: atualiza valor e/ou tipo_aula de um lançamento individual.
  // SEC-01 FIX: agora bloqueia a edição no próprio service se o mês já
  // tiver sido fechado, em vez de depender apenas da UI.
  async updateLancamento(id, campos) {
    const { data: atual, error: errBusca } = await supabase
      .from('repasses_lancamentos')
      .select('professor_id, data_referencia')
      .eq('id', id)
      .single();

    if (errBusca) throw errBusca;

    if (await this._mesEstaFechado(atual.professor_id, atual.data_referencia)) {
      throw new Error('Não é possível editar: o mês deste lançamento já foi fechado.');
    }

    const permitidos = ['valor', 'tipo_aula', 'modalidade', 'data_referencia', 'status'];
    const payload = Object.fromEntries(
      Object.entries(campos).filter(([k]) => permitidos.includes(k))
    );
    if (Object.keys(payload).length === 0) throw new Error('Nenhum campo válido para atualizar.');

    const { data, error } = await supabase
      .from('repasses_lancamentos')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // EDIT-02: exclui um lançamento individual.
  // SEC-01 FIX: agora bloqueia a exclusão no próprio service se o mês
  // já tiver sido fechado, em vez de depender apenas da UI.
  async deleteLancamento(id) {
    const { data: atual, error: errBusca } = await supabase
      .from('repasses_lancamentos')
      .select('professor_id, data_referencia')
      .eq('id', id)
      .single();

    if (errBusca) throw errBusca;

    if (await this._mesEstaFechado(atual.professor_id, atual.data_referencia)) {
      throw new Error('Não é possível excluir: o mês deste lançamento já foi fechado.');
    }

    const { error } = await supabase
      .from('repasses_lancamentos')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  },
};