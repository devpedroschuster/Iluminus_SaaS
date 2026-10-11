import { describe, it, expect } from 'vitest';
import { decidirRotaPublica, decidirRotaPrivada } from './navigation';

// ILU-99: as rotas reagiam a estados intermediários do login.
// - Conta desativada: por um instante havia sessão sem perfil, e /login
//   mandava para rotaPorPerfil(null) = /area-aluno, que devolvia para /login
//   (laço de centenas de trocas).
// - Primeiro acesso: a ida para /redefinir-senha era um navigate solto no
//   Login, que às vezes se perdia. Agora é o estado do login que decide.

const SESSAO = { user: { id: 'uid-1' } };
const estado = (campos = {}) => ({ sessao: SESSAO, perfil: 'aluno', primeiroAcesso: false, loading: false, ...campos });

describe('decidirRotaPublica (/, /login)', () => {
  it('sessão sem perfil mostra a própria página, sem mandar para a área do aluno (regressão ILU-99)', () => {
    expect(decidirRotaPublica(estado({ perfil: null }))).toBe('pagina');
  });

  it('sem sessão mostra a própria página', () => {
    expect(decidirRotaPublica(estado({ sessao: null, perfil: null }))).toBe('pagina');
  });

  it('carregando o perfil: espera', () => {
    expect(decidirRotaPublica(estado({ perfil: null, loading: true }))).toBe('carregando');
  });

  it('logado: vai para a tela do perfil', () => {
    expect(decidirRotaPublica(estado({ perfil: 'professor' }))).toBe('/agenda');
    expect(decidirRotaPublica(estado({ perfil: 'admin' }))).toBe('/dashboard');
    expect(decidirRotaPublica(estado())).toBe('/area-aluno');
  });

  it('primeiro acesso: vai para a troca de senha (regressão ILU-99)', () => {
    expect(decidirRotaPublica(estado({ perfil: 'professor', primeiroAcesso: true }))).toBe('/redefinir-senha');
  });
});

describe('decidirRotaPrivada', () => {
  it('carregando o perfil: espera', () => {
    expect(decidirRotaPrivada(estado({ loading: true }), ['aluno'])).toBe('carregando');
  });

  it('sem sessão ou sem perfil: login', () => {
    expect(decidirRotaPrivada(estado({ sessao: null, perfil: null }), ['aluno'])).toBe('/login');
    expect(decidirRotaPrivada(estado({ perfil: null }), ['aluno'])).toBe('/login');
  });

  it('primeiro acesso: troca de senha antes de qualquer tela (regressão ILU-99)', () => {
    expect(decidirRotaPrivada(estado({ perfil: 'professor', primeiroAcesso: true }), ['admin', 'professor'])).toBe('/redefinir-senha');
  });

  it('papel sem permissão: a tela do próprio perfil', () => {
    expect(decidirRotaPrivada(estado(), ['admin'])).toBe('/area-aluno');
  });

  it('papel permitido: libera', () => {
    expect(decidirRotaPrivada(estado({ perfil: 'admin' }), ['admin', 'professor'])).toBe('liberado');
  });
});
