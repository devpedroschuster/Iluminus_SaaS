import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./repasseService', () => ({ gerarRepassesDaMensalidade: vi.fn() }));

import { supabase } from '../lib/supabase';
import { agendamentoService } from './agendamentoService';

// Cada chamada a supabase.from() recebe o próximo resultado da fila.
function filaDeQueries(...resultados) {
  const mocks = resultados.map((r) => criarQueryMock(r));
  let i = 0;
  supabase.from.mockImplementation(() => mocks[i++].query);
  return mocks.map((m) => m.chamadas);
}

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
