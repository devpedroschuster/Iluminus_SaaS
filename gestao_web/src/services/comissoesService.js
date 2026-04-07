import { supabase } from '../lib/supabase';

const TAXAS = {
  professor: 0.50,
  espaco: 0.35,
  diretor: 0.15
};

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
    const dataInicio = `${mesAno}-01`;
    const dataFim = new Date(mesAno.split('-')[0], mesAno.split('-')[1], 0).toISOString().split('T')[0];

    const { data: fechamento } = await supabase
      .from('fechamento_comissoes')
      .select('*')
      .eq('professor_id', professorId)
      .eq('mes_referencia', dataInicio)
      .single();

    let totalComissaoFixo = 0;
    let totalComissaoLivre = 0;
    let totalAlunosLivre = 0;
    
    const { data: profMods } = await supabase
      .from('modalidades')
      .select('nome')
      .eq('professor_id', professorId);
    
    const nomesModalidadesProf = profMods?.map(m => m.nome) || [];
    const detalhesMensalidades = [];

    if (nomesModalidadesProf.length > 0) {
      const { data: mensalidades } = await supabase
        .from('mensalidades')
        .select(`
          id,
          data_vencimento,
          status,
          alunos ( id, nome_completo, modalidades_selecionadas ),
          planos ( nome, preco )
        `)
        .gte('data_vencimento', dataInicio)
        .lte('data_vencimento', dataFim);

      if (mensalidades) {
        mensalidades.forEach(mensalidade => {
          const plano = mensalidade.planos;
          const aluno = mensalidade.alunos;
          
          if (!plano || !aluno || plano.nome.toLowerCase().includes('livre')) return;

          const modsAluno = aluno.modalidades_selecionadas || [];
          const modsDesseProf = modsAluno.filter(mod => nomesModalidadesProf.includes(mod));
          
          if (modsDesseProf.length > 0) {
            const qtdModalidadesTotais = modsAluno.length;
            const valorPlano = Number(plano.preco) || 0;
            
            const valorPoteProfessores = valorPlano * TAXAS.professor;
            
            const valorPorModalidade = valorPoteProfessores / qtdModalidadesTotais;
            
            const valorFinalProf = valorPorModalidade * modsDesseProf.length;

            detalhesMensalidades.push({
              aluno: aluno.nome_completo,
              plano: plano.nome,
              valor_comissao: valorFinalProf
            });

            totalComissaoFixo += valorFinalProf;
          }
        });
      }
    }

    // PRESENÇAS (PLANO LIVRE x AVULSO)
    const aulasMap = new Map();

    const { data: presencas } = await supabase
      .from('presencas')
      .select(`
        id,
        data_aula,
        data_checkin,
        agenda!inner ( id, atividade, valor_por_aluno ),
        alunos ( id, nome_completo, planos ( nome ) )
      `)
      .eq('agenda.professor_id', professorId);

    if (presencas) {
      presencas.forEach(p => {
        const dataPresenca = p.data_aula || p.data_checkin?.split('T')[0];
        
        if (!dataPresenca || dataPresenca < dataInicio || dataPresenca > dataFim) return;

        const planoNome = p.alunos?.planos?.nome?.toLowerCase() || '';
        
        if (planoNome.includes('livre') || !p.alunos?.planos) {
          const aulaChave = `${p.agenda.id}-${dataPresenca}`;
          const valorBase = Number(p.agenda.valor_por_aluno) || 0;
          const comissaoAluno = valorBase * TAXAS.professor;
          
          if (!aulasMap.has(aulaChave)) {
            aulasMap.set(aulaChave, {
              chave: aulaChave,
              data_aula: dataPresenca,
              atividade: p.agenda.atividade,
              qtd_alunos: 0,
              valor_base: valorBase,
              total_comissao: 0
            });
          }

          const aulaObj = aulasMap.get(aulaChave);
          aulaObj.qtd_alunos += 1;
          aulaObj.total_comissao += comissaoAluno;
          
          totalComissaoLivre += comissaoAluno;
          totalAlunosLivre += 1;
        }
      });
    }

    const aulas = Array.from(aulasMap.values()).sort((a, b) => new Date(a.data_aula) - new Date(b.data_aula));

    return {
      fechamento,
      mensalidades: detalhesMensalidades,
      aulas,
      resumo: {
        total_comissao_fixo: totalComissaoFixo,
        total_comissao_livre: totalComissaoLivre,
        total_comissao: totalComissaoFixo + totalComissaoLivre,
        total_aulas: aulas.length,
        total_alunos: totalAlunosLivre
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