import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { estadoListaMatriculas, consultasAfetadasPeloCadastro } from './matriculas';

// ILU-121: depois de cadastrar (ou editar) um aluno, as telas que guardam
// dados por alguns minutos não podem continuar mostrando a lista antiga. Usa
// um QueryClient de verdade porque o bug era de casamento de prefixo: a chave
// única ['alunos', 'professores', 'presencas', 'leads'] não casava com
// nenhuma consulta.
describe('consultasAfetadasPeloCadastro', () => {
  function invalidarComCacheDasTelas() {
    const queryClient = new QueryClient();
    const chavesDasTelas = {
      alunos:       ['alunos', { busca: '', status: 'ativos' }, 1],
      matriculas:   ['alunos', 'matriculas-recentes', 30],
      agenda:       ['alunos', 'ativos-agendamento'],
      dashboard:    ['dashboard', '2026-11-17', '2026-11-01', '2026-11-24'],
      financeiro:   ['financeiro', 11, 2026],
      leads:        ['leads', 'pendentes'],
      notificacoes: ['notificacoes-gerais'],
      modalidades:  ['modalidades'],
    };
    Object.values(chavesDasTelas).forEach((chave) => queryClient.setQueryData(chave, []));

    consultasAfetadasPeloCadastro().forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));

    return (tela) => queryClient.getQueryState(chavesDasTelas[tela]).isInvalidated;
  }

  it('atualiza as listas de alunos: Alunos, Matrículas e a grade da Agenda', () => {
    const invalidada = invalidarComCacheDasTelas();
    expect(invalidada('alunos')).toBe(true);
    expect(invalidada('matriculas')).toBe(true);
    expect(invalidada('agenda')).toBe(true);
  });

  it('atualiza o Dashboard, o Financeiro (1ª cobrança do plano), os leads e os avisos', () => {
    const invalidada = invalidarComCacheDasTelas();
    expect(invalidada('dashboard')).toBe(true);
    expect(invalidada('financeiro')).toBe(true);
    expect(invalidada('leads')).toBe(true);
    expect(invalidada('notificacoes')).toBe(true);
  });

  it('não joga fora o resto do cache', () => {
    expect(invalidarComCacheDasTelas()('modalidades')).toBe(false);
  });
});

// ILU-120: a página "Matrículas" nunca pode dizer "Nenhuma matrícula" sem ter
// certeza — nem sem conexão (consulta pausada pelo React Query), nem enquanto
// a janela maior ainda carrega em cima de uma lista anterior vazia.
const base = { isError: false, isPending: false, isPlaceholderData: false, fetchStatus: 'idle', total: 0 };

describe('estadoListaMatriculas', () => {
  it('erro tem prioridade, mesmo pausado', () => {
    expect(estadoListaMatriculas({ ...base, isError: true, fetchStatus: 'paused' })).toBe('erro');
  });

  it('sem conexão na primeira visita: consulta pendente e pausada', () => {
    expect(estadoListaMatriculas({ ...base, isPending: true, fetchStatus: 'paused' })).toBe('sem-conexao');
  });

  it('sem conexão depois de "Ver mais antigas": dado provisório e pausado', () => {
    expect(estadoListaMatriculas({ ...base, isPlaceholderData: true, fetchStatus: 'paused', total: 3 })).toBe('sem-conexao');
  });

  it('carregando na primeira busca', () => {
    expect(estadoListaMatriculas({ ...base, isPending: true, fetchStatus: 'fetching' })).toBe('carregando');
  });

  it('carregando quando a janela maior ainda busca e a anterior estava vazia', () => {
    expect(estadoListaMatriculas({ ...base, isPlaceholderData: true, fetchStatus: 'fetching', total: 0 })).toBe('carregando');
  });

  it('vazio só com a resposta da janela atual', () => {
    expect(estadoListaMatriculas(base)).toBe('vazio');
  });

  it('lista quando há matrículas, inclusive as da janela anterior enquanto a maior carrega', () => {
    expect(estadoListaMatriculas({ ...base, total: 2 })).toBe('lista');
    expect(estadoListaMatriculas({ ...base, isPlaceholderData: true, fetchStatus: 'fetching', total: 2 })).toBe('lista');
  });
});
