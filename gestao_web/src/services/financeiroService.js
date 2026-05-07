import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';

export const financeiroService = {
  async listarMensalidades(inicio, fim) {
    const { data, error } = await supabase
      .from('mensalidades')
      .select(`
        *,
        alunos (nome_completo),
        planos (nome, preco)
      `)
      .gte('data_vencimento', inicio)
      .lte('data_vencimento', fim)
      .order('data_vencimento', { ascending: true });

    if (error) throw error;
    return data;
  },

  async gerarMensalidades(mes, ano) {
    // 1. Busca todos os alunos ativos que possuem plano
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id')
      .eq('ativo', true)
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;

    // 2. Busca a última mensalidade de cada aluno para saber de onde partir o cálculo
    const { data: ultimasMensalidades } = await supabase
      .from('mensalidades')
      .select('aluno_id, data_vencimento')
      .order('data_vencimento', { ascending: false });

    // Criamos um mapa para identificar rapidamente a última data de cada aluno
    const mapaUltimasDatas = new Map();
    ultimasMensalidades?.forEach(m => {
      if (!mapaUltimasDatas.has(m.aluno_id)) {
        mapaUltimasDatas.set(m.aluno_id, m.data_vencimento);
      }
    });

    const novasCobrancas = [];

    alunos.forEach(aluno => {
      const ultimaDataStr = mapaUltimasDatas.get(aluno.id);
      
      if (ultimaDataStr) {
        // CALCULA O PRÓXIMO CICLO: Última data + 30 dias
        const d = new Date(ultimaDataStr + 'T12:00:00');
        d.setDate(d.getDate() + 30);
        
        const proximaData = d.toISOString().split('T')[0];
        const [pAno, pMes] = proximaData.split('-').map(Number);

        // Se a próxima data calculada cair no mês/ano que você selecionou no painel
        // Nota: 'mes' vem do JavaScript (0-11), por isso comparamos com mes + 1
        if (pAno === ano && pMes === (mes + 1)) {
          novasCobrancas.push({
            aluno_id: aluno.id,
            plano_id: aluno.plano_id,
            data_vencimento: proximaData,
            status: 'pendente'
          });
        }
      }
    });

    // 3. Insere as novas mensalidades, cada uma no seu dia correto
    if (novasCobrancas.length > 0) {
      const { error: errInsert } = await supabase
        .from('mensalidades')
        .insert(novasCobrancas);
      if (errInsert) throw errInsert;
    }
    
    return true;
  },

  async confirmarPagamento(id, dados) {
      // dados deve incluir: valor_pago, forma_pagamento (obrigatório),
      //                     tipo_aula (default 'regular'), professor_id?, modalidade_nome?
      const payload = {
        status: 'pago',
        valor_pago: dados.valor_pago,
        forma_pagamento: dados.forma_pagamento,
        metodo_pagamento: dados.forma_pagamento, // compat. com coluna antiga, se ainda existir
        tipo_aula: dados.tipo_aula || 'regular',
        professor_id: dados.professor_id || null,
        modalidade_nome: dados.modalidade_nome || null,
        data_pagamento: new Date().toISOString().split('T')[0],
      };
  
      const { error } = await supabase
        .from('mensalidades')
        .update(payload)
        .eq('id', id);
      if (error) throw error;
  
      // Dispara o motor de repasses
      const resultado = await gerarRepassesDaMensalidade(id);
      return { ok: true, resultado };
    },
  };