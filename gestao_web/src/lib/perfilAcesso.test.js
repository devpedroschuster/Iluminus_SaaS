import { describe, it, expect } from 'vitest';
import { resolverAcesso } from './perfilAcesso';

// ILU-98: o login procurava primeiro em `alunos`. Um professor ativo com um
// cadastro antigo de aluno inativo (mesmo auth_id) era tratado como "aluno
// inativo" e desconectado, sem nunca chegar à checagem de professor.

const aluno = (campos = {}) => ({
  id: 6, role: 'aluno', ativo: true, primeiro_acesso: false, nome_completo: 'Ana Souza', ...campos,
});
const professor = (campos = {}) => ({
  id: 'prof-1', nome: 'Bia Lima', ativo: true, primeiro_acesso: false, ...campos,
});

describe('resolverAcesso (regressão ILU-98)', () => {
  it('professor ativo com cadastro de aluno inativo entra como professor', () => {
    expect(resolverAcesso(aluno({ ativo: false, primeiro_acesso: true }), professor())).toEqual({
      perfil: 'professor', bloqueio: null, primeiroAcesso: false, nome: 'Bia Lima', professorId: 'prof-1', tambemAluno: false,
    });
  });

  it('vale o primeiro acesso do cadastro que venceu', () => {
    expect(resolverAcesso(aluno({ ativo: false }), professor({ primeiro_acesso: true })).primeiroAcesso).toBe(true);
    expect(resolverAcesso(aluno({ primeiro_acesso: true }), null).primeiroAcesso).toBe(true);
  });

  it('ativo nos dois cadastros: o professor vence', () => {
    expect(resolverAcesso(aluno(), professor())).toMatchObject({ perfil: 'professor', professorId: 'prof-1' });
  });

  // ILU-83: quem é professor e aluno ativo entra como professor, mas pode
  // abrir a própria Área do Aluno.
  it('professor com cadastro de aluno ativo: tambemAluno', () => {
    expect(resolverAcesso(aluno(), professor()).tambemAluno).toBe(true);
    expect(resolverAcesso(aluno({ ativo: null }), professor()).tambemAluno).toBe(true);
  });

  it('cadastro de aluno inativo não dá acesso à Área do Aluno', () => {
    expect(resolverAcesso(aluno({ ativo: false }), professor()).tambemAluno).toBe(false);
  });

  it('só professor, só aluno ou admin: tambemAluno falso', () => {
    expect(resolverAcesso(null, professor()).tambemAluno).toBe(false);
    expect(resolverAcesso(aluno(), null).tambemAluno).toBe(false);
    expect(resolverAcesso(aluno({ role: 'admin' }), professor()).tambemAluno).toBe(false);
  });

  it('admin continua admin, mesmo com cadastro de professor', () => {
    expect(resolverAcesso(aluno({ role: 'admin' }), professor())).toEqual({
      perfil: 'admin', bloqueio: null, primeiroAcesso: false, nome: 'Ana Souza', professorId: null, tambemAluno: false,
    });
  });

  it('admin com ativo = false continua entrando, como antes', () => {
    expect(resolverAcesso(aluno({ role: 'admin', ativo: false }), null).perfil).toBe('admin');
  });

  it('cadastro de professor inativo não derruba um aluno ativo', () => {
    expect(resolverAcesso(aluno(), professor({ ativo: false }))).toEqual({
      perfil: 'aluno', bloqueio: null, primeiroAcesso: false, nome: 'Ana Souza', professorId: null, tambemAluno: false,
    });
  });

  it('ativo vazio (null) conta como ativo, como no resto do app', () => {
    expect(resolverAcesso(null, professor({ ativo: null })).perfil).toBe('professor');
    expect(resolverAcesso(aluno({ ativo: null }), null).perfil).toBe('aluno');
  });

  it.each([
    ['só aluno inativo', aluno({ ativo: false }), null],
    ['só professor inativo', null, professor({ ativo: false })],
    ['os dois inativos', aluno({ ativo: false }), professor({ ativo: false })],
  ])('%s: conta desativada', (_, a, p) => {
    expect(resolverAcesso(a, p)).toEqual({
      perfil: null, bloqueio: 'desativado', primeiroAcesso: false, nome: null, professorId: null, tambemAluno: false,
    });
  });

  it('nenhum cadastro: conta sem perfil', () => {
    expect(resolverAcesso(null, null)).toEqual({
      perfil: null, bloqueio: 'sem_perfil', primeiroAcesso: false, nome: null, professorId: null, tambemAluno: false,
    });
  });
});
