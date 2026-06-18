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

  // REP-04: upsert com constraint (professor_id, mes_referencia).
  async fecharMes(professorId, mesAno, valorTotal) {
    const { error } = await supabase
      .from('fechamento_comissoes')
      .upsert([{
        professor_id: professorId,
        mes_referencia: `${mesAno}-01`,
        valor_total: valorTotal,
        fechado_em: new Date().toISOString(),
      }], { onConflict: 'professor_id,mes_referencia' });

    if (error) throw error;
    return true;
  },

  // EDIT-01: atualiza valor e/ou tipo_aula de um lançamento individual.
  // Só permite edição se o mês ainda não foi fechado (verificado na UI).
  async updateLancamento(id, campos) {
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
  // Só permite exclusão se o mês ainda não foi fechado (verificado na UI).
  async deleteLancamento(id) {
    const { error } = await supabase
      .from('repasses_lancamentos')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  },
};