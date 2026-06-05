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