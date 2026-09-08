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
    // ILU-22: `verificarDisponibilidade` retorna `null` (não o objeto de
    // fallback usado em falha de rede/API) quando `dados.aula_id` é falsy —
    // acessar `checagem.podeAgendarLivremente` direto lançava um TypeError
    // não tratado em vez da mensagem de validação esperada.
    if (!checagem?.podeAgendarLivremente) throw new Error(checagem?.avisoCritico ?? 'Selecione uma turma.');
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

  // professorId (opcional): quando informado, filtra no servidor só pelas
  // presenças de aulas daquele professor (join via agenda.professor_id) —
  // evita mandar pro cliente nomes/presença de alunos de outros professores
  // (ver ILU-45). Admin não passa professorId e continua vendo tudo.
  async listarPresencasPeriodo(inicio, fim, professorId = null) {
    let query = supabase
      .from('presencas')
      .select(
        professorId
          ? 'id, aluno_id, data_checkin, data_aula, aula_id, status, origem, alunos ( id, nome_completo ), agenda!inner ( professor_id )'
          : 'id, aluno_id, data_checkin, data_aula, aula_id, status, origem, alunos ( id, nome_completo )'
      )
      .gte('data_aula', inicio)
      .lte('data_aula', fim);

    if (professorId) {
      query = query.eq('agenda.professor_id', professorId);
    }

    const { data, error } = await query;
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
      // ILU-18: mesmo padrão de alunosService.alterarStatus.
      const { data, error } = await supabase
        .from('presencas')
        .update({ status: 'cancelado', cancelado_em: new Date().toISOString(), cancelado_motivo: motivo })
        .eq('id', existente.id)
        .select('id, status')
        .single();
      if (error) throw error;
      if (data.status !== 'cancelado') {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
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
    // ILU-18: o filtro `.eq('status', 'cancelado')` faz 0 linhas afetadas
    // ser um resultado ESPERADO quando não há falta pra reverter (proteção
    // original) — diferente dos outros casos deste arquivo, aqui não dá pra
    // simplesmente exigir 1 linha sempre. Por isso primeiro localizamos a
    // linha (se existir, ainda cancelada) e só então aplicamos o mesmo
    // padrão de alunosService.alterarStatus na atualização por id, que
    // distingue "nada para reverter" (ok, retorna cedo) de "a linha existia
    // mas a atualização não pegou" (RLS/permissão — deve virar erro).
    const { data: existente, error: errBusca } = await supabase
      .from('presencas')
      .select('id')
      .eq('aluno_id', alunoId)
      .eq('aula_id', aulaId)
      .eq('data_aula', dataEspecifica)
      .eq('status', 'cancelado')
      .maybeSingle();
    if (errBusca) throw errBusca;
    if (!existente) return; // nada para reverter — comportamento já esperado

    const { data, error } = await supabase
      .from('presencas')
      .update({ status: 'agendado', cancelado_em: null, cancelado_motivo: null })
      .eq('id', existente.id)
      .select('id, status')
      .single();
    if (error) throw error;
    if (data.status !== 'agendado') {
      throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
    }
  },

  // Marca presença manualmente (uso do admin, a qualquer horário — antes,
  // durante ou depois da aula). Reaproveita a mesma regra de realizarCheckin
  // do Presenca.jsx: se já existe linha em `presencas` (id_relacao), faz
  // UPDATE preservando a origem; se não existe ainda (fixo cuja linha o job
  // noturno ainda não gerou), faz INSERT com origem 'fixo'.
  // reposicaoDeId (opcional): se informado, marca esta presença como
  // reposição da falta apontada (presencas.id de uma linha com
  // status 'falta' ou 'cancelado'). Ver ILU-8.
  async marcarPresenca({ alunoId, aulaId, dataAula, idRelacao, tipo, reposicaoDeId = null }) {
    const dataCheckin = `${dataAula}T12:00:00`;

    if (idRelacao) {
      // origem 'agendamento' sinaliza que essa presença veio de um registro
      // que já existia como 'agendado' — assim desmarcarPresenca sabe que
      // deve reverter para 'agendado' em vez de apagar a linha.
      // ILU-18: mesmo padrão de alunosService.alterarStatus.
      const { data, error } = await supabase
        .from('presencas')
        .update({
          status: 'presente',
          data_checkin: dataCheckin,
          origem: 'agendamento',
          reposicao_de_id: reposicaoDeId,
        })
        .eq('id', idRelacao)
        .select('id, status')
        .single();
      if (error) throw error;
      if (data.status !== 'presente') {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
      return;
    }

    const { error } = await supabase
      .from('presencas')
      .insert({
        aluno_id: alunoId,
        aula_id: aulaId,
        data_aula: dataAula,
        status: 'presente',
        origem: tipo === 'fixo' ? 'fixo' : 'avulso',
        data_checkin: dataCheckin,
        reposicao_de_id: reposicaoDeId,
      });
    if (error && error.code === '23505') throw new Error("Este aluno já possui um registro nesta aula e data.");
    else if (error) throw error;
  },

  // Desmarca uma presença já confirmada. Espelha desfazerCheckin do
  // Presenca.jsx: se a origem é 'agendamento' (veio de um agendamento
  // prévio), volta para 'agendado'; caso contrário (fixo/avulso lançado
  // direto como presente), remove a linha por completo.
  async desmarcarPresenca({ idRelacao, tipo }) {
    if (!idRelacao) return;

    if (tipo === 'agendamento') {
      // ILU-18: mesmo padrão de alunosService.alterarStatus.
      const { data, error } = await supabase
        .from('presencas')
        .update({ status: 'agendado', data_checkin: null })
        .eq('id', idRelacao)
        .select('id, status')
        .single();
      if (error) throw error;
      if (data.status !== 'agendado') {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
      return;
    }

    const { error } = await supabase.from('presencas').delete().eq('id', idRelacao);
    if (error) throw error;
  }
};