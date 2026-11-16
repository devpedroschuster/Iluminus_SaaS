import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { configuracoesRepasseService } from './configuracoesRepasseService';

// Os campos do formulário de Configurações de Repasse.
const CAMPOS_FORM = {
  valor_1_modalidade: 100,
  valor_multi_modalidade: 70,
  plano_livre_pct_casa: 50,
  plano_livre_pct_prof: 50,
  aula_experimental_valor: 0,
  aula_experimental_pct_prof: 0,
  aula_avulsa_valor: 50,
  aula_avulsa_pct_casa: 30,
  aula_avulsa_pct_prof: 70,
};

// O que o formulário devolve: a linha inteira de obter() (reset(configs)),
// com os campos editados.
const PAYLOAD = {
  ...CAMPOS_FORM,
  id: 1,
  singleton: true,
  apuracao_automatica: true,
  corte_competencia: '2026-11-01',
  updated_at: '2026-11-10T12:00:00+00:00',
  updated_by: 'u1',
};

// O PostgREST devolve numeric como string.
const comoStrings = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));

describe('configuracoesRepasseService.salvar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava só os campos do formulário (nunca corte, apuração automática, id, singleton, updated_by)', async () => {
    const { query, chamadas } = criarQueryMock({ data: { ...PAYLOAD, ...comoStrings(CAMPOS_FORM) }, error: null });
    supabase.from.mockReturnValue(query);

    await expect(configuracoesRepasseService.salvar(PAYLOAD)).resolves.toBe(true);

    const update = chamadas.find(([m]) => m === 'update')[1];
    const { updated_at: carimbo, ...gravados } = update;
    expect(gravados).toEqual(CAMPOS_FORM);
    expect(carimbo).not.toBe(PAYLOAD.updated_at);
    expect(chamadas).toContainEqual(['eq', 'id', 1]);
  });

  it('recusa quando um campo do formulário não foi aplicado', async () => {
    const { query } = criarQueryMock({
      data: { ...PAYLOAD, ...comoStrings(CAMPOS_FORM), valor_1_modalidade: '90' },
      error: null,
    });
    supabase.from.mockReturnValue(query);

    await expect(configuracoesRepasseService.salvar(PAYLOAD))
      .rejects.toThrow('A atualização não foi aplicada. Verifique suas permissões.');
  });
});
