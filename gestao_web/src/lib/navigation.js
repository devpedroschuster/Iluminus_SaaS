/**
 * Retorna a rota home de cada perfil.
 * Fonte única de verdade — use em Login, RedefinirSenha, App e qualquer
 * outro ponto que precise redirecionar com base no perfil do usuário.
 *
 * @param {string|null|undefined} perfil - 'admin' | 'professor' | 'aluno' | null
 * @returns {string} caminho de rota
 */
export function rotaPorPerfil(perfil) {
  if (perfil === 'admin') return '/dashboard';
  if (perfil === 'professor') return '/agenda';
  return '/area-aluno'; // aluno ou qualquer valor inesperado
}

// ILU-99: as rotas decidem a partir do estado do login (useAuth), em vez de
// cada tela navegar por conta própria. Devolvem 'carregando' (spinner), a
// página pedida ('pagina' / 'liberado') ou o caminho para onde redirecionar.
// Sessão sem perfil é estado de passagem (conta sendo desconectada): mostrar o
// login evita o laço /login <-> /area-aluno.

// "/" e "/login".
export function decidirRotaPublica({ sessao, perfil, primeiroAcesso, loading }) {
  if (loading) return 'carregando';
  if (!sessao || !perfil) return 'pagina';
  return primeiroAcesso ? '/redefinir-senha' : rotaPorPerfil(perfil);
}

// Rotas que exigem login, com os perfis permitidos.
// ILU-83: o professor que também é aluno ativo (`tambemAluno`) entra nas
// rotas de aluno — a própria Área do Aluno.
export function decidirRotaPrivada({ sessao, perfil, primeiroAcesso, loading, tambemAluno }, permitidos) {
  if (loading) return 'carregando';
  if (!sessao || !perfil) return '/login';
  if (primeiroAcesso) return '/redefinir-senha';
  const permitido = !permitidos
    || permitidos.includes(perfil)
    || (perfil === 'professor' && tambemAluno && permitidos.includes('aluno'));
  if (!permitido) return rotaPorPerfil(perfil);
  return 'liberado';
}