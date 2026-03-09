import { supabase } from '../lib/supabase';

export const comissoesService = {
  async listarProfessores() {
    const { data, error } = await supabase
      .from('professores')
      .select('id, nome, pix_comissao')
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;
    return data;
  },

  async buscarDetalhes(professorId, mesAno) {
    const dataInicio = `${mesAno}-01`;
    const dataFim = new Date(mesAno.split('-')[0], mesAno.split('-')[1], 0).toISOString().split('T')[0];

    const { data: fechamento } = await supabase
      .from('fechamento_comissoes')
      .select('*')
      .eq('professor_id', professorId)
      .eq('mes_referencia', dataInicio)
      .single();

    const { data: presencas, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_aula,
        agenda!inner (
          id,
          atividade,
          valor_por_aluno,
          espaco
        )
      `)
      .eq('agenda.professor_id', professorId)
      .eq('agenda.espaco', 'danca')
      .gte('data_aula', dataInicio)
      .lte('data_aula', dataFim);

    if (error) throw error;

    const aulasAgrupadas = {};
    let totalAlunos = 0;
    let totalComissao = 0;

    presencas?.forEach(p => {
      const chave = `${p.agenda.id}-${p.data_aula}`;
      const valorBase = Number(p.agenda.valor_por_aluno) || 0;
      const comissaoPorAluno = valorBase * 0.5; // 50%

      if (!aulasAgrupadas[chave]) {
        aulasAgrupadas[chave] = {
          chave,
          data_aula: p.data_aula,
          atividade: p.agenda.atividade,
          valor_base: valorBase,
          qtd_alunos: 0,
          total_comissao: 0
        };
      }
      
      aulasAgrupadas[chave].qtd_alunos += 1;
      aulasAgrupadas[chave].total_comissao += comissaoPorAluno;
      
      totalAlunos += 1;
      totalComissao += comissaoPorAluno;
    });

    const listaAulas = Object.values(aulasAgrupadas).sort((a, b) => 
      new Date(a.data_aula) - new Date(b.data_aula)
    );

    return {
      fechamento,
      aulas: listaAulas,
      resumo: {
        total_aulas: listaAulas.length,
        total_alunos: totalAlunos,
        total_comissao: totalComissao
      }
    };
  },

  async fecharMes(dados) {
    const { data, error } = await supabase
      .from('fechamento_comissoes')
      .insert([{
        professor_id: dados.professor_id,
        mes_referencia: dados.mes_referencia,
        valor_total: dados.valor_total,
        quantidade_aulas: dados.quantidade_aulas,
        quantidade_alunos: dados.quantidade_alunos
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};