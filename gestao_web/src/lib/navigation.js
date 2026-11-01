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
export function decidirRotaPrivada({ sessao, perfil, primeiroAcesso, loading }, permitidos) {
  if (loading) return 'carregando';
  if (!sessao || !perfil) return '/login';
  if (primeiroAcesso) return '/redefinir-senha';
  if (permitidos && !permitidos.includes(perfil)) return rotaPorPerfil(perfil);
  return 'liberado';
}