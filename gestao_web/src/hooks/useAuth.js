import { useContext } from 'react';
import { AuthContext } from '../providers/AuthContext';

// Estado de login do app, mantido por um único AuthProvider (ILU-99):
// sessao, perfil, professorId, nome, nomeUsuario, primeiroAcesso, loading,
// contaDesativada, perfilNaoEncontrado e recarregarAcesso().
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return ctx;
}
