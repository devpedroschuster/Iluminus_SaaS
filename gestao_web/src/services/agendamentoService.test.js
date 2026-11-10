import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { gerarRepassesDaMensalidade } from './repasseService';
import { agendamentoService } from './agendamentoService';

// Cada chamada a supabase.from() recebe o próximo resultado da fila.
function filaDeQueries(...resultados) {
  const mocks = resultados.map((r) => criarQueryMock(r));
  let i = 0;
  supabase.from.mockImplementation(() => mocks[i++].query);
  return mocks.map((m) => m.chamadas);
}

// A experimental entra pendente no Financeiro (muitas vezes pagam só no dia da
// aula), a não ser que o visitante já tenha pago no agendamento.
describe('agendamentoService.agendarAulaAdmin — aula experimental', () => {
  beforeEach(() => vi.clearAllMocks());

  const dadosVisitante = {
    tipo: 'visitante', ignorarAvisos: true, nome_visitante: 'Bia',
    aula_id: '9', data_aula: '2026-11-05', valor_experimental: '50',
    forma_pagamento_experimental: 'pix',
  };

  it('por padrão registra cobrança pendente: sem forma de pagamento e sem repasse', async () => {
    supabase.rpc.mockResolvedValue({ data: { lead_id: 1, mensalidade_id: 2, pago: false }, error: null });

    const resultado = await agendamentoService.agendarAulaAdmin(dadosVisitante);

    expect(supabase.rpc).toHaveBeenCalledWith('agendar_aula_experimental', expect.objectContaining({
      p_nome: 'Bia', p_aula_id: 9, p_valor: 50, p_forma_pagamento: null, p_ja_pago: false,
    }));
    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
    expect(resultado).toEqual({ lead_id: 1, mensalidade_id: 2, pago: false });
  });

  it('com "já foi pago", manda a forma de pagamento e gera o repasse', async () => {
    supabase.rpc.mockResolvedValue({ data: { lead_id: 1, mensalidade_id: 2, pago: true }, error: null });

    await agendamentoService.agendarAulaAdmin({ ...dadosVisitante, experimental_ja_pago: true });

    expect(supabase.rpc).toHaveBeenCalledWith('agendar_aula_experimental', expect.objectContaining({
      p_forma_pagamento: 'pix', p_ja_pago: true,
    }));
    expect(gerarRepassesDaMensalidade).toHaveBeenCalledWith(2);
  });

  it('experimental gratuita não gera repasse nem marcada como paga', async () => {
    supabase.rpc.mockResolvedValue({ data: { lead_id: 1, mensalidade_id: null, pago: false }, error: null });

    await agendamentoService.agendarAulaAdmin({ ...dadosVisitante, valor_experimental: '0', experimental_ja_pago: true });

    expect(gerarRepassesDaMensalidade).not.toHaveBeenCalled();
  });
});

// As presenças de 3 meses do calendário passam das 1000 linhas que a API
// devolve por requisição: o excedente sumia da grade.
describe('agendamentoService.listarPresencasPeriodo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('busca todas as páginas, ordenadas, além do limite de 1000 linhas', async () => {
    const pagina1 = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));
    const pagina2 = [{ id: 1001 }, { id: 1002 }];
    const [chamadas1, chamadas2] = filaDeQueries(
      { data: pagina1, error: null },
      { data: pagina2, error: null },
    );

    const presencas = await agendamentoService.listarPresencasPeriodo('2026-09-01', '2026-11-30');

    expect(presencas).toHaveLength(1002);
    expect(chamadas1).toContainEqual(['order', 'id']);
    expect(chamadas1).toContainEqual(['range', 0, 999]);
    expect(chamadas2).toContainEqual(['range', 1000, 1999]);
    expect(chamadas2).toContainEqual(['gte', 'data_aula', '2026-09-01']);
    expect(chamadas2).toContainEqual(['lte', 'data_aula', '2026-11-30']);
  });

  it('mantém o filtro por professor em todas as páginas (ILU-45)', async () => {
    const [chamadas] = filaDeQueries({ data: [{ id: 1 }], error: null });

    await agendamentoService.listarPresencasPeriodo('2026-09-01', '2026-11-30', 'prof-1');

    expect(chamadas).toContainEqual(['eq', 'agenda.professor_id', 'prof-1']);
  });
});

// ILU-78: 'falta' = não veio e não avisou (conta no limite semanal e barra a
// confirmação automática da presença presumida). 'cancelado' = avisou.
describe('agendamentoService.registrarFaltaSemAviso', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca falta na linha existente e limpa o check-in', async () => {
    const [busca, update] = filaDeQueries(
      { data: { id: 7 }, error: null },
      { data: { id: 7, status: 'falta' }, error: null },
    );
    await agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08');
    expect(busca).toContainEqual(['eq', 'aluno_id', 3]);
    expect(busca).toContainEqual(['eq', 'aula_id', 9]);
    expect(busca).toContainEqual(['eq', 'data_aula', '2026-10-08']);
    expect(update).toContainEqual(['update', { status: 'falta', data_checkin: null }]);
    expect(update).toContainEqual(['eq', 'id', 7]);
  });

  it('cria a linha de falta para fixo que ainda não tem linha', async () => {
    const [, insert] = filaDeQueries({ data: null, error: null }, { error: null });
    await agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08');
    expect(insert).toContainEqual(['insert', {
      aluno_id: 3, aula_id: 9, data_aula: '2026-10-08', status: 'falta', origem: 'fixo',
    }]);
  });

  it('acusa erro quando a atualização não pega (RLS)', async () => {
    filaDeQueries({ data: { id: 7 }, error: null }, { data: { id: 7, status: 'presente' }, error: null });
    await expect(agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08'))
      .rejects.toThrow('A atualização não foi aplicada');
  });

  // ILU-95: toque duplo num fixo sem linha — o 2º insert bate na chave única
  // (aluno, aula, data) porque o 1º acabou de criar a linha.
  it('toque duplo: se a linha surgiu entre a busca e o insert, marca falta nela', async () => {
    const [, , busca2, update] = filaDeQueries(
      { data: null, error: null },
      { error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { data: { id: 7 }, error: null },
      { data: { id: 7, status: 'falta' }, error: null },
    );
    await agendamentoService.registrarFaltaSemAviso(3, 9, '2026-10-08');
    expect(busca2).toContainEqual(['eq', 'data_aula', '2026-10-08']);
    expect(update).toContainEqual(['update', { status: 'falta', data_checkin: null }]);
    expect(update).toContainEqual(['eq', 'id', 7]);
  });
});

describe('agendamentoService.registrarFalta', () => {
  beforeEach(() => vi.clearAllMocks());

  // ILU-95: mesmo caso do toque duplo, na falta com aviso.
  it('toque duplo: se a linha surgiu entre a busca e o insert, marca cancelado nela', async () => {
    const [, , busca2, update] = filaDeQueries(
      { data: null, error: null },
      { error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { data: { id: 7, status: 'cancelado' }, error: null },
      { data: { id: 7, status: 'cancelado' }, error: null },
    );
    await agendamentoService.registrarFalta(3, 9, '2026-10-08');
    expect(busca2).toContainEqual(['eq', 'data_aula', '2026-10-08']);
    expect(update).toContainEqual(['update', expect.objectContaining({ status: 'cancelado' })]);
    expect(update).toContainEqual(['eq', 'id', 7]);
  });
});

describe('agendamentoService.removerFalta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('desfaz tanto falta com aviso (cancelado) quanto sem aviso (falta)', async () => {
    const [busca, update] = filaDeQueries(
      { data: { id: 5 }, error: null },
      { data: { id: 5, status: 'agendado' }, error: null },
    );
    await agendamentoService.removerFalta(3, 9, '2026-10-08');
    expect(busca).toContainEqual(['in', 'status', ['cancelado', 'falta']]);
    expect(update).toContainEqual(['eq', 'id', 5]);
  });
});

describe('agendamentoService.listarChamadaCompleta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca as reservas feitas pelo próprio aluno no app (via_app)', async () => {
    const porTabela = {
      presencas: { data: [{ id: 1, status: 'presente', origem: 'agendamento', aluno_id: 3, agendado_pelo_app: true, alunos: { id: 3, nome_completo: 'Ana' } }], error: null },
      agenda_fixa: { data: [], error: null },
      leads: { data: [], error: null },
    };
    const chamadas = {};
    supabase.from.mockImplementation((tabela) => {
      const mock = criarQueryMock(porTabela[tabela]);
      chamadas[tabela] = mock.chamadas;
      return mock.query;
    });
    const lista = await agendamentoService.listarChamadaCompleta(9, '2026-10-08');
    expect(chamadas.presencas[0][1]).toContain('agendado_pelo_app');
    expect(lista).toEqual([expect.objectContaining({ id_relacao: 1, via_app: true, status: 'presente' })]);
  });
});
