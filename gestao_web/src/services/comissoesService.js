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
    const dataInicio = `${mesAno}-01T00:00:00`;
    const ultimoDia = new Date(mesAno.split('-')[0], mesAno.split('-')[1], 0).toISOString().split('T')[0];
    const dataFim = `${ultimoDia}T23:59:59`;

    // 1. Verifica se já existe um Fechamento Salvo
    const { data: fechamento } = await supabase
      .from('fechamento_comissoes')
      .select('*')
      .eq('professor_id', professorId)
      .eq('mes_referencia', `${mesAno}-01`)
      .maybeSingle();

    // 2. Busca as Modalidades deste Professor para calcular o Fixo
    const { data: modalidadesProf } = await supabase
      .from('modalidades')
      .select('*')
      .eq('professor_id', professorId);
      
    const modalidadesMap = new Map(modalidadesProf?.map(m => [m.nome, m]) || []);

    /* =========================================================
       BALDE 1: COMISSÕES FIXAS (Alunos Regulares / Assinaturas)
       ========================================================= */
    const { data: alunos } = await supabase
      .from('alunos')
      .select('id, nome_completo, modalidades_selecionadas, planos(nome, preco)')
      .eq('ativo', true);

    let comissoesFixas = [];
    let totalFixo = 0;

    if (alunos) {
      alunos.forEach(aluno => {
        const nomePlano = aluno.planos?.nome?.toLowerCase() || '';
        const isLivre = !aluno.planos || nomePlano.includes('livre') || nomePlano.includes('avulso');
        
        if (isLivre) return; 

        const modsAluno = aluno.modalidades_selecionadas || [];
        if (modsAluno.length === 0) return;

        // NOVO: Conta a frequência (peso) de cada modalidade do aluno (Ex: Funcional = 2, Dança = 1)
        const frequenciaMods = {};
        modsAluno.forEach(m => {
          frequenciaMods[m] = (frequenciaMods[m] || 0) + 1;
        });

        // O Rateio: Divide o valor do plano pelo total de "cotas" (length do array)
        // Se custa R$ 390 e ele faz 3x na semana (independente de qual aula), cada cota vale R$ 130
        const valorPorCota = aluno.planos.preco / modsAluno.length;

        // Vê se o aluno faz alguma aula que pertence a este professor
        Object.keys(frequenciaMods).forEach(mNome => {
          if (modalidadesMap.has(mNome)) {
            const qtdVezes = frequenciaMods[mNome]; // Quantas vezes na semana ele faz essa aula
            const mod = modalidadesMap.get(mNome);
            const taxa = mod.taxa_professor || 0;
            
            // O valor base é a cota multiplicada por quantas vezes ele faz
            const valorBaseAgregado = valorPorCota * qtdVezes;
            const valorComissao = valorBaseAgregado * (taxa / 100);

            if (valorComissao > 0) {
                totalFixo += valorComissao;
                comissoesFixas.push({
                  aluno_nome: aluno.nome_completo,
                  plano_nome: aluno.planos.nome,
                  modalidade: `${mNome} (${qtdVezes}x)`, // Exibe bonitinho no relatório: "Funcional (2x)"
                  valor_base: valorBaseAgregado,
                  taxa_aplicada: taxa,
                  comissao: valorComissao
                });
            }
          }
        });
      });
    }

    /* =========================================================
       BALDE 2: COMISSÕES VARIÁVEIS (Presenças em Plano Livre)
       ========================================================= */
    const { data: presencas, error: errP } = await supabase
      .from('presencas')
      .select(`
        id, data_checkin,
        alunos (id, nome_completo, planos (nome, preco)),
        agenda!inner (id, atividade, valor_por_aluno, modalidades (taxa_professor))
      `)
      .eq('agenda.professor_id', professorId)
      .gte('data_checkin', dataInicio)
      .lte('data_checkin', dataFim);

    if (errP) console.error("Erro presenças:", errP);

    let comissoesVariaveis = [];
    let totalVariavel = 0;
    const aulasMap = new Map();

    if (presencas) {
      presencas.forEach(p => {
        const nomePlano = p.alunos?.planos?.nome?.toLowerCase() || '';
        const isLivre = !p.alunos?.planos || nomePlano.includes('livre') || nomePlano.includes('avulso');
        
        // Se NÃO for livre, a comissão dele já foi calculada no Balde 1! Ignoramos a presença.
        if (!isLivre) return; 

        // MATEMÁTICA DO PLANO LIVRE:
        // Prioridade 1: O "Valor base por aluno" configurado lá no calendário para aquela aula específica.
        // Prioridade 2: Pega o preço total do Plano Livre e divide por 12 (média justa de aulas no mês) para não quebrar o caixa.
        const precoPlano = p.alunos?.planos?.preco || 0;
        const valorBase = p.agenda.valor_por_aluno > 0 
                          ? p.agenda.valor_por_aluno 
                          : (precoPlano > 0 ? precoPlano / 12 : 0);

        const taxaPercentual = p.agenda?.modalidades?.taxa_professor ?? 50; 
        const comissaoAluno = valorBase * (taxaPercentual / 100);

        if (comissaoAluno > 0) {
          totalVariavel += comissaoAluno;

          const dataPresenca = p.data_checkin.split('T')[0];
          const aulaChave = `${p.agenda.id}-${dataPresenca}`;

          if (!aulasMap.has(aulaChave)) {
            aulasMap.set(aulaChave, {
              data_aula: dataPresenca,
              atividade: p.agenda.atividade,
              taxa_aplicada: taxaPercentual,
              valor_base_unidade: valorBase,
              qtd_alunos_avulsos: 0,
              total_comissao: 0
            });
          }
          const aulaObj = aulasMap.get(aulaChave);
          aulaObj.qtd_alunos_avulsos += 1;
          aulaObj.total_comissao += comissaoAluno;
        }
      });
    }

    comissoesVariaveis = Array.from(aulasMap.values()).sort((a, b) => new Date(a.data_aula) - new Date(b.data_aula));

    return {
      fechamento,
      comissoesFixas,
      comissoesVariaveis,
      resumo: {
        total_fixo: totalFixo,
        total_variavel: totalVariavel,
        total_comissao: totalFixo + totalVariavel,
        qtd_alunos_fixos: comissoesFixas.length,
        qtd_aulas_variaveis: comissoesVariaveis.length
      }
    };
  },

  async fecharMes(dados) {
    const { data, error } = await supabase
      .from('fechamento_comissoes')
      .insert([dados])
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};