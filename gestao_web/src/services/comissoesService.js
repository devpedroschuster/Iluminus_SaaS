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

  async fecharMes(professorId, mesAno, valorTotal) {
    const { error } = await supabase
      .from('fechamento_comissoes')
      .insert([{
        professor_id: professorId,
        mes_referencia: `${mesAno}-01`,
        valor_total: valorTotal
      }]);

    if (error) throw error;
    return true;
  }
};