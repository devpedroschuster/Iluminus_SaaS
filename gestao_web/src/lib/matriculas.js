/**
 * ILU-120: o que a página "Matrículas" mostra, a partir do estado da consulta
 * do React Query. A página nunca pode dizer "Nenhuma matrícula" sem ter
 * certeza:
 * - sem conexão, o React Query (networkMode 'online') pausa a consulta em vez
 *   de falhar — `isError` fica falso e não há dado nenhum;
 * - depois de "Ver mais antigas", a lista da janela anterior fica como dado
 *   provisório (`isPlaceholderData`) até a janela maior responder.
 *
 * @returns {'erro' | 'sem-conexao' | 'carregando' | 'vazio' | 'lista'}
 */
export function estadoListaMatriculas({ isError, isPending, isPlaceholderData, fetchStatus, total }) {
  if (isError) return 'erro';
  if (fetchStatus === 'paused' && (isPending || isPlaceholderData)) return 'sem-conexao';
  if (isPending) return 'carregando';
  if (total === 0) return isPlaceholderData ? 'carregando' : 'vazio';
  return 'lista';
}
