import { supabase } from '../lib/supabase';
import { resolverAcesso } from '../lib/perfilAcesso';

// Busca os dois cadastros da pessoa e decide o perfil (ILU-98). Uma tabela que
// falha é registrada e conta como "sem cadastro", como já era antes.
export async function buscarAcesso(authId) {
  const [aluno, professor] = await Promise.all([
    supabase.from('alunos')
      .select('id, role, ativo, primeiro_acesso, nome_completo')
      .eq('auth_id', authId)
      .maybeSingle(),
    supabase.from('professores')
      .select('id, nome, ativo, primeiro_acesso')
      .eq('auth_id', authId)
      .maybeSingle(),
  ]);
  if (aluno.error && aluno.error.code !== 'PGRST116') console.error('Erro ao verificar aluno:', aluno.error);
  if (professor.error && professor.error.code !== 'PGRST116') console.error('Erro ao verificar professor:', professor.error);
  return resolverAcesso(aluno.data ?? null, professor.data ?? null);
}
