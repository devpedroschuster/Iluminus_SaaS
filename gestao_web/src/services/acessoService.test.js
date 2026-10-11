import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarQueryMock } from '../test/criarQueryMock';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import { supabase } from '../lib/supabase';
import { buscarAcesso } from './acessoService';

// Cada tabela devolve o seu resultado; guarda as chamadas feitas em cada uma.
function porTabela(resultados) {
  const mocks = Object.fromEntries(
    Object.entries(resultados).map(([tabela, r]) => [tabela, criarQueryMock(r)]),
  );
  supabase.from.mockImplementation((tabela) => mocks[tabela].query);
  return Object.fromEntries(Object.entries(mocks).map(([tabela, m]) => [tabela, m.chamadas]));
}

describe('buscarAcesso (ILU-98)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('busca os dois cadastros pelo auth_id e aplica a regra: professor vence aluno inativo', async () => {
    const chamadas = porTabela({
      alunos: { data: { id: 6, role: 'aluno', ativo: false, primeiro_acesso: true, nome_completo: 'Ana' }, error: null },
      professores: { data: { id: 'prof-1', nome: 'Bia', ativo: true, primeiro_acesso: false }, error: null },
    });

    await expect(buscarAcesso('uid-1')).resolves.toMatchObject({ perfil: 'professor', professorId: 'prof-1' });
    expect(chamadas.alunos).toContainEqual(['eq', 'auth_id', 'uid-1']);
    expect(chamadas.professores).toContainEqual(['eq', 'auth_id', 'uid-1']);
  });

  // Como antes: uma tabela que falha é registrada e conta como "sem cadastro".
  // Fazer o erro subir cairia no catch do useAuth, que deixa sessão sem perfil
  // (o laço /login <-> área da ILU-39).
  it('falha ao ler uma tabela é registrada e a outra ainda decide', async () => {
    const erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    porTabela({
      alunos: { data: null, error: { code: '57014', message: 'statement timeout' } },
      professores: { data: { id: 'prof-1', nome: 'Bia', ativo: true, primeiro_acesso: false }, error: null },
    });

    await expect(buscarAcesso('uid-1')).resolves.toMatchObject({ perfil: 'professor' });
    expect(erroConsole).toHaveBeenCalled();
    erroConsole.mockRestore();
  });
});
