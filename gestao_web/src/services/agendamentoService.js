import { supabase } from '../lib/supabase';

export const agendamentoService = {

  async verificarDisponibilidade(aulaId, dataAula, alunoId = null) {
    if (!aulaId) return null;

    try {
      const { data, error } = await supabase.rpc('verificar_disponibilidade_v2', {
        p_aula_id: aulaId,
        p_data: dataAula,
        p_aluno_id: alunoId || null
      });

      if (error) throw error;
      return data;

    } catch (error) {
      console.error("Erro estrutural ao verificar disponibilidade:", error);

      return {
        podeAgendarLivremente: false,
        avisoCritico: "Não foi possível verificar as vagas no momento. Verifique sua conexão.",
        capacidadeMax: 0,
        ocupacaoAtual: 0,
        limiteSemanal: 0,
        usoSemanal: 0,
        isLivre: false,
        modNome: 'Indisponível',
        temModalidadeNoPlano: false
      };
    }
  },

  // dados.tipo: 'aluno' (matriculado) ou 'visitante' (lead/experimental)
async agendarAulaAdmin(dados) {
  if (!dados.ignorarAvisos) {
    const checagem = await agendamentoService.verificarDisponibilidade(
      dados.aula_id,
      dados.data_aula,
      dados.tipo === 'visitante' ? null : dados.aluno_id
    );
    if (!checagem.podeAgendarLivremente) throw new Error(checagem.avisoCritico);
  }

  if (dados.tipo === 'visitante') {
    // Snapshot do professor responsável pela turma NO MOMENTO do agendamento.
    // Congela o vínculo aqui — se a turma for reatribuída depois, este lead
    // continua marcado com o professor que efetivamente deu a experimental.
    const { data: aulaAtual, error: erroAula } = await supabase
      .from('agenda')
      .select('professor_id')
      .eq('id', dados.aula_id)
      .single();
    if (erroAula) throw erroAula;

    const payload = {
      nome: dados.nome_visitante,
      telefone: dados.telefone_visitante || null,
      aula_id: dados.aula_id,
      data_aula: dados.data_aula,
      data_checkin: `${dados.data_aula}T12:00:00`,
      status_conversao: 'pendente',
      professor_id: aulaAtual?.professor_id ?? null,
    };
    const { error } = await supabase.from('leads').insert([payload]);
    if (error) throw error;
    return;
  }

  const payload = {
    aluno_id: dados.aluno_id,
    aula_id: dados.aula_id,
    data_aula: dados.data_aula,
    status: 'agendado',
    origem: 'avulso',
  };
  const { error } = await supabase.from('presencas').insert([payload]);
  if (error && error.code === '23505') throw new Error("Este aluno já possui um agendamento nesta mesma turma e mesma data.");
  else if (error) throw error;
},

  // Cancela um agendamento. `tipo` indica a origem do id_relacao:
  // 'lead' -> remove de `leads`. Qualquer outro valor -> trata como
  // `presencas` (comportamento padrão, mantém histórico via status='cancelado').
  async cancelarAgendamento(id, tipo = 'presenca') {
    if (tipo === 'lead') {
      const { data, error } = await supabase.from('leads').delete().eq('id', id).select();
      if (error) throw error;
      return data;
    }

    const { data: linha, error: errBusca } = await supabase
      .from('presencas')
      .select('status')
      .eq('id', id)
      .single();
    if (errBusca) throw errBusca;

    if (linha?.status === 'agendado') {
      const { data, error } = await supabase
        .from('presencas')
        .update({ status: 'cancelado', cancelado_em: new Date().toISOString() })
        .eq('id', id)
        .select();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase.from('presencas').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  },

  async listarPresencasPeriodo(inicio, fim) {
    const { data, error } = await supabase
      .from('presencas')
      .select('id, aluno_id, data_checkin, data_aula, aula_id, status, origem, alunos ( id, nome_completo )')
      .gte('data_aula', inicio)
      .lte('data_aula', fim);
    if (error) throw error;
    return data;
  },

  async listarPresencas(aulaId, dataAula) {
    const { data, error } = await supabase
      .from('presencas')
      .select('id, data_checkin, status, origem, alunos ( id, nome_completo )')
      .eq('aula_id', aulaId)
      .eq('data_aula', dataAula);
    if (error) throw error;
    return data;
  },

  // Lista de chamada do dia: une presencas (já cobre fixo gerado pelo job +
  // avulso) com agenda_fixa para fixos cuja linha ainda não foi gerada
  // (ex: chamada aberta antes do job noturno rodar, ou matrícula criada
  // depois da geração). Evita duplicar quem já tem linha em presencas.
  async listarChamadaCompleta(aulaId, dataAula) {
    const [{ data: presencasDia }, { data: fixos }, { data: leadsDia }] = await Promise.all([
      supabase
        .from('presencas')
        .select('id, status, origem, aluno_id, alunos(id, nome_completo)')
        .eq('aula_id', aulaId)
        .eq('data_aula', dataAula),
      supabase
        .from('agenda_fixa')
        .select('id, aluno_id, alunos(id, nome_completo)')
        .eq('aula_id', aulaId),
      supabase
        .from('leads')
        .select('id, nome, status_conversao')
        .eq('aula_id', aulaId)
        .eq('data_aula', dataAula),
    ]);

    const alunoIdsComLinha = new Set((presencasDia || []).map(p => p.aluno_id));
    const lista = [];

    // Fixos que ainda não têm linha gerada pra hoje — mostra como 'agendado'
    // (estado padrão, ainda não houve check-in nem job de falta rodou)
    (fixos || []).forEach(f => {
      if (alunoIdsComLinha.has(f.aluno_id)) return; // já coberto pela linha em presencas
      lista.push({
        id_relacao: null, // não existe linha em presencas ainda
        aluno_id: f.alunos.id,
        nome: f.alunos.nome_completo,
        tipo: 'fixo',
        status: 'agendado',
      });
    });

    // Leads/experimentais agendados pra essa aula
    (leadsDia || []).forEach(l => {
      lista.push({
        id_relacao: l.id,
        aluno_id: null,
        nome: l.nome,
        tipo: 'experimental',
        status: 'agendado',
      });
    });

    // Tudo que já tem linha em presencas (fixo gerado + avulso)
    (presencasDia || []).forEach(p => {
      lista.push({
        id_relacao: p.id,
        aluno_id: p.aluno_id,
        nome: p.alunos?.nome_completo,
        tipo: p.origem, // 'fixo' | 'avulso'
        status: p.status, // 'agendado' | 'presente' | 'falta' | 'cancelado'
      });
    });

    return lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  },

  // Falta com aviso prévio (recepção/admin registra que o aluno avisou
  // que não virá). Antes: insert em agenda_excecoes. Agora: UPDATE direto
  // na linha de presencas, que dispara notificação ao professor (migration 008).
  // Se a linha ainda não existir (fixo sem linha gerada pra hoje), cria com
  // status já 'cancelado'.
  async registrarFalta(alunoId, aulaId, dataEspecifica, motivo = null) {
    const { data: existente } = await supabase
      .from('presencas')
      .select('id, status')
      .eq('aluno_id', alunoId)
      .eq('aula_id', aulaId)
      .eq('data_aula', dataEspecifica)
      .maybeSingle();

    if (existente) {
      const { error } = await supabase
        .from('presencas')
        .update({ status: 'cancelado', cancelado_em: new Date().toISOString(), cancelado_motivo: motivo })
        .eq('id', existente.id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase
      .from('presencas')
      .insert({
        aluno_id: alunoId,
        aula_id: aulaId,
        data_aula: dataEspecifica,
        status: 'cancelado',
        origem: 'fixo',
        cancelado_em: new Date().toISOString(),
        cancelado_motivo: motivo,
      });
    if (error) throw error;
  },

  // Reverte um aviso de falta (volta para 'agendado').
  async removerFalta(alunoId, aulaId, dataEspecifica) {
    const { error } = await supabase
      .from('presencas')
      .update({ status: 'agendado', cancelado_em: null, cancelado_motivo: null })
      .eq('aluno_id', alunoId)
      .eq('aula_id', aulaId)
      .eq('data_aula', dataEspecifica)
      .eq('status', 'cancelado'); // só reverte se ainda estava cancelado (proteção)
    if (error) throw error;
  }
};