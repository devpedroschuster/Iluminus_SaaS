import { supabase } from '../lib/supabase';
import { hojeBrasilia } from '../lib/utils';

// ILU-24: `filtros.busca` (campo de busca livre) era interpolado direto na
// string crua do filtro `.or()` do PostgREST — um termo contendo vírgula ou
// parênteses (ex.: "x,id.neq.0") quebrava a intenção do OR e era
// interpretado como cláusulas de filtro adicionais. Envolver o valor em
// aspas duplas (sintaxe de valor escapado do PostgREST) e escapar
// barra-invertida/aspas internas neutraliza qualquer caractere reservado
// (`,`, `(`, `)`) do termo de busca do usuário.
function escaparValorFiltroOr(valor) {
  return String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ILU-76: chama a Edge Function `criar_usuario` (só admin) e devolve as
// credenciais provisórias. Quando a função responde não-2xx, o supabase-js
// só entrega um FunctionsHttpError — a mensagem real do servidor (ex.: "Este
// e-mail já possui um acesso.") fica no corpo da resposta e era trocada por
// um genérico "Falha na comunicação".
async function invocarCriarUsuario(body) {
  const { data, error } = await supabase.functions.invoke('criar_usuario', { body });
  if (error) {
    let mensagem = null;
    try {
      mensagem = (await error.context?.json?.())?.error ?? null;
    } catch {
      // corpo ausente ou não-JSON: fica a mensagem genérica
    }
    throw new Error(mensagem || 'Falha na comunicação com o servidor seguro.');
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.senha_temporaria) throw new Error('O servidor não devolveu a senha provisória.');
  return { email: data.email, senha: data.senha_temporaria };
}

export const alunosService = {
  async listar(filtros = {}, paginacao = {}) {
    try {
      const { pagina = 1, tamanho = 25 } = paginacao;
      const inicio = (pagina - 1) * tamanho;
      const fim    = inicio + tamanho - 1;

      let query = supabase
        .from('alunos')
        .select('*, planos(nome)', { count: 'exact' });

      if (filtros.role && filtros.role !== 'todos')
        query = query.eq('role', filtros.role);

      if (filtros.busca) {
        const busca = escaparValorFiltroOr(filtros.busca);
        query = query.or(`nome_completo.ilike."%${busca}%",email.ilike."%${busca}%"`);
      }

      if (filtros.letraInicial)
        query = query.ilike('nome_completo', `${filtros.letraInicial}%`);

      // ILU-76: status de acesso ao app — mesmas regras de statusAcessoApp.
      if (filtros.acesso === 'sem_acesso') {
        query = query.is('auth_id', null);
      } else if (filtros.acesso === 'ativo') {
        query = query.not('auth_id', 'is', null).eq('primeiro_acesso', false);
      } else if (filtros.acesso === 'senha_antiga' || filtros.acesso === 'provisoria') {
        query = query.not('auth_id', 'is', null).eq('primeiro_acesso', true);
        query = filtros.acesso === 'provisoria'
          ? query.not('acesso_gerado_em', 'is', null)
          : query.is('acesso_gerado_em', null);
      }

      const { data, error, count } = await query
        .order('nome_completo')
        .range(inicio, fim);

      if (error) throw error;
      return { data, count };
    } catch (error) {
      console.error('[alunosService.listar]', error);
      throw error;
    }
  },

  async listarAtivos() {
    try {
      const { data, error } = await supabase
        .from('alunos')
        .select('id, nome_completo')
        .eq('ativo', true)
        .eq('role', 'aluno')
        .order('nome_completo');

      if (error) throw error;
      return data ?? [];
    } catch (error) {
      console.error('[alunosService.listarAtivos]', error);
      throw error;
    }
  },

  async criar(dados) {
    try {
      const { data, error } = await supabase
        .from('alunos')
        .insert([dados])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[alunosService.criar]', error);
      throw error;
    }
  },

  async atualizar(id, dados) {
    try {
      const { data, error } = await supabase
        .from('alunos')
        .update(dados)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[alunosService.atualizar]', error);
      throw error;
    }
  },

  async excluir(id) {
    try {
      const { error } = await supabase
        .from('alunos')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('[alunosService.excluir]', error);
      throw error;
    }
  },

  async alterarStatus(id, novoStatus) {
    try {
      // ILU-13: `.update()` sem `.select()` retorna sucesso mesmo quando
      // 0 linhas são afetadas (ex.: RLS bloqueando silenciosamente). Sem
      // conferir a linha retornada, a UI mostrava "Aluno desativado com
      // sucesso" mesmo quando `ativo` nunca mudou no banco.
      const { data, error } = await supabase
        .from('alunos')
        .update({ ativo: novoStatus })
        .eq('id', id)
        .select('id, ativo')
        .single();

      if (error) throw error;
      if (data.ativo !== novoStatus) {
        throw new Error('A atualização não foi aplicada. Verifique suas permissões.');
      }
      return true;
    } catch (error) {
      console.error('[alunosService.alterarStatus]', error);
      throw error;
    }
  },

  async listarAniversariantes() {
    const { data, error } = await supabase
      .from('alunos')
      .select('id, nome_completo, data_nascimento, telefone, planos(nome)')
      .not('data_nascimento', 'is', null);

    if (error) throw error;
    return data;
  },

  async buscarPerfilCompleto(alunoId) {
    const { data, error } = await supabase
      .from('alunos')
      .select(`
        *,
        planos (nome, regras_acesso)
      `)
      .eq('id', alunoId)
      .single();

    if (error) throw error;
    return data;
  },

  async buscarHistoricoPlanos(alunoId) {
    const { data, error } = await supabase
      .from('historico_planos')
      .select(`
        *,
        planos (nome, regras_acesso)
      `)
      .eq('aluno_id', alunoId)
      .order('data_inicio', { ascending: false });

    if (error) throw error;
    return data;
  },

  async buscarHistoricoFrequencia(alunoId) {
    // ILU-37: limitada aos check-ins mais recentes — a tela de perfil só
    // exibe uma janela de ~90 dias (heatmap de 12 semanas + filtro de data),
    // então buscar todo o histórico sem limite cresce sem necessidade para
    // alunos antigos.
    const { data, error } = await supabase
      .from('presencas')
      .select(`
        *,
        agenda (atividade)
      `)
      .eq('aluno_id', alunoId)
      .order('data_checkin', { ascending: false })
      .limit(500);

    if (error) throw error;
    return data;
  },

  // ─────────────────────────────────────────────────────────────
  // BP-01 FIX: operações encadeadas substituídas por RPC atômica.
  // Todas as escritas ocorrem dentro de uma única transação
  // Postgres — se qualquer etapa falhar, o banco faz rollback
  // automático e nenhuma escrita parcial é persistida.
  //
  // ILU-69: as RPCs `matricular_aluno` e `renovar_plano_aluno` sempre
  // criam a mensalidade como 'pendente', sem data_pagamento. O repasse ao
  // professor é gerado quando o pagamento é confirmado
  // (financeiroService.confirmarPagamento / adicionarPagamentoManual).
  // A antiga etapa REP-08, que procurava a mensalidade logo após a RPC para
  // disparar o repasse, nunca encontrava nada (ordenava por
  // `mensalidades.created_at`, coluna que não existe, e filtrava por uma
  // data_pagamento que a RPC não grava) — só gerava um 400 e um aviso
  // falso. Foi removida.
  //
  // ILU-73: o wrapper `matricular` (RPC `matricular_aluno`) foi removido —
  // não tinha chamadores; o cadastro de aluno (NovoAluno.jsx) grava
  // histórico e primeira mensalidade por conta própria.
  // ─────────────────────────────────────────────────────────────

  /**
   * Renova o plano de um aluno de forma atômica via RPC.
   * Função SQL correspondente: renovar_plano_aluno()
   *
   * @returns {{ sucesso: true }}
   */
  async renovarPlano(alunoId, dadosRenovacao) {
    try {
      const { error } = await supabase.rpc('renovar_plano_aluno', {
        p_aluno_id:          alunoId,
        p_plano_id:          dadosRenovacao.plano_id,
        p_data_inicio:       dadosRenovacao.data_inicio,
        p_data_fim:          dadosRenovacao.data_fim,
        p_valor_pago:        dadosRenovacao.valor_pago ?? 0,
        p_forma_recebimento: dadosRenovacao.forma_recebimento ?? 'recorrente',
      });

      if (error) throw error;

      return { sucesso: true };
    } catch (error) {
      console.error('[alunosService.renovarPlano]', error);
      throw error;
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ILU-8: resumo de frequência do aluno (aulas previstas x feitas,
  // faltas, reposições feitas/pendentes) para o período do plano vigente.
  // ─────────────────────────────────────────────────────────────

  async buscarResumoFrequencia(alunoId) {
    const { data, error } = await supabase
      .rpc('fn_resumo_frequencia_aluno', { p_aluno_id: alunoId })
      .single();

    if (error) throw error;
    return data;
  },

  // Faltas (sem ou com aviso) do aluno, dentro do período do plano vigente,
  // que ainda não têm uma reposição vinculada. Usado para popular o seletor
  // "é reposição de qual falta" ao marcar presença numa aula avulsa.
  async listarFaltasPendentesReposicao(alunoId) {
    const resumo = await this.buscarResumoFrequencia(alunoId);
    if (!resumo?.periodo_inicio) return [];

    const { data: faltas, error } = await supabase
      .from('presencas')
      .select('id, data_aula, status, agenda ( atividade )')
      .eq('aluno_id', alunoId)
      .in('status', ['falta', 'cancelado'])
      .gte('data_aula', resumo.periodo_inicio)
      .lte('data_aula', resumo.periodo_fim)
      .order('data_aula', { ascending: false });

    if (error) throw error;

    const { data: reposicoesExistentes, error: errRep } = await supabase
      .from('presencas')
      .select('reposicao_de_id')
      .not('reposicao_de_id', 'is', null)
      .in('reposicao_de_id', (faltas ?? []).map(f => f.id));

    if (errRep) throw errRep;

    const jaRepostaIds = new Set((reposicoesExistentes ?? []).map(r => r.reposicao_de_id));
    return (faltas ?? []).filter(f => !jaRepostaIds.has(f.id));
  },

  async normalizarHistoricoPlanos() {
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, plano_id, data_inicio_plano, data_fim_plano, created_at')
      .not('plano_id', 'is', null);

    if (errAlunos) throw errAlunos;
    if (!alunos?.length) return { normalizados: 0, ignorados: 0 };

    const { data: historicosAtivos, error: errHistoricos } = await supabase
      .from('historico_planos')
      .select('aluno_id')
      .eq('status', 'ativo')
      .in('aluno_id', alunos.map(a => a.id));

    if (errHistoricos) throw errHistoricos;

    const comHistorico = new Set(historicosAtivos?.map(h => h.aluno_id));

    const calcularDataFimFallback = () => {
      // ILU-66: parte de hojeBrasilia() (não de `new Date()` em UTC) para
      // que o fallback de 30 dias não erre por um dia perto da meia-noite
      // em Brasília.
      const fallback = new Date(`${hojeBrasilia()}T12:00:00`);
      fallback.setDate(fallback.getDate() + 30);
      return fallback.toISOString().split('T')[0];
    };

    const alunosSemHistorico = alunos.filter(a => !comHistorico.has(a.id));
    const ignorados = alunos.length - alunosSemHistorico.length;

    if (!alunosSemHistorico.length) {
      console.info('[normalizarHistoricoPlanos] Nenhum aluno sem histórico ativo.');
      return { normalizados: 0, ignorados };
    }

    const inserts = alunosSemHistorico.map(a => ({
      aluno_id:    a.id,
      plano_id:    a.plano_id,
      data_inicio: a.data_inicio_plano ?? a.created_at.split('T')[0],
      data_fim:    a.data_fim_plano    ?? calcularDataFimFallback(),
      status:      'ativo',
      valor_pago:  0,
    }));

    const { error: errInsert } = await supabase
      .from('historico_planos')
      .insert(inserts);

    if (errInsert) throw errInsert;

    const normalizados = inserts.length;
    console.info(
      `[normalizarHistoricoPlanos] Normalizados: ${normalizados}, Ignorados: ${ignorados}`
    );
    return { normalizados, ignorados };
  },

  // ─────────────────────────────────────────────────────────────
  // ILU-11: marca/desmarca um aluno como bolsista (matriculado, mas
  // não paga mensalidade), independente do plano que ele tiver.
  //
  // Ao ATIVAR (bolsista = true):
  //   1) seta alunos.bolsista = true;
  //   2) zera IMEDIATAMENTE todas as mensalidades em aberto
  //      (pendente/atrasado) do aluno — valor_pago = 0, status = 'pago',
  //      forma_pagamento = 'bolsa' — independente do valor do plano
  //      vinculado. Não dispara geração de repasse (comissão), já que
  //      não há pagamento real associado.
  //
  // Ao DESATIVAR (bolsista = false):
  //   apenas remove a flag. Não recria cobranças retroativas — a
  //   cobrança volta ao normal a partir da próxima geração mensal
  //   (gerar-mensalidades), que passa a considerar o plano vigente.
  //
  // @param {string} alunoId
  // @param {boolean} bolsista
  // @returns {{ aluno: object, mensalidadesZeradas: number }}
  // ─────────────────────────────────────────────────────────────
  async definirBolsista(alunoId, bolsista) {
    try {
      const { data: aluno, error: errUpdate } = await supabase
        .from('alunos')
        .update({ bolsista: !!bolsista })
        .eq('id', alunoId)
        .select()
        .single();

      if (errUpdate) throw errUpdate;

      let mensalidadesZeradas = 0;

      if (bolsista) {
        const { data: zeradas, error: errZerar } = await supabase
          .from('mensalidades')
          .update({
            valor_pago: 0,
            status: 'pago',
            forma_pagamento: 'bolsa',
            // ILU-19: hojeBrasilia() em vez de UTC.
            data_pagamento: hojeBrasilia(),
          })
          .eq('aluno_id', alunoId)
          .in('status', ['pendente', 'atrasado'])
          .select('id');

        if (errZerar) throw errZerar;
        mensalidadesZeradas = zeradas?.length ?? 0;
      }

      return { aluno, mensalidadesZeradas };
    } catch (error) {
      console.error('[alunosService.definirBolsista]', error);
      throw error;
    }
  },

  // ILU-76: cria o login do app para um aluno já cadastrado. O servidor
  // vincula o login ao aluno e marca primeiro_acesso; a senha provisória só
  // existe nesta resposta (mostrar uma única vez ao admin).
  async criarAcessoApp(alunoId) {
    return invocarCriarUsuario({ acao: 'criar', aluno_id: alunoId });
  },

  // ILU-76/ILU-77: gera uma nova senha provisória para quem já tem login — a
  // senha anterior deixa de valer e as sessões abertas do aluno são derrubadas.
  async gerarNovaSenhaApp(alunoId) {
    return invocarCriarUsuario({ acao: 'resetar_senha', aluno_id: alunoId });
  },
};