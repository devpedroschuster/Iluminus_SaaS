// Decide com que perfil a pessoa entra no app a partir dos seus cadastros em
// `alunos` e `professores` (mesmo auth_id). Regra única para o login, o
// carregamento da sessão e a troca de senha (ILU-98).
//
// Ordem: admin > professor ativo > aluno ativo. O professor ativo vence o
// cadastro de aluno, ativo ou não: a mesma pessoa pode ter sido aluna antes.
// `ativo` vazio conta como ativo, como no resto do app. O primeiro acesso que
// vale é o do cadastro que venceu.
//
// ILU-83: o professor que também é aluno ativo entra como professor, com
// `tambemAluno`, que libera a própria Área do Aluno (agendar as aulas que faz
// e ver as mensalidades).
const ativo = (cadastro) => cadastro.ativo !== false;

export function resolverAcesso(aluno, professor) {
  if (aluno?.role === 'admin') {
    return {
      perfil: 'admin', bloqueio: null, primeiroAcesso: !!aluno.primeiro_acesso,
      nome: aluno.nome_completo ?? null, professorId: null, tambemAluno: false,
    };
  }
  if (professor && ativo(professor)) {
    return {
      perfil: 'professor', bloqueio: null, primeiroAcesso: !!professor.primeiro_acesso,
      nome: professor.nome ?? null, professorId: professor.id,
      tambemAluno: !!aluno && ativo(aluno),
    };
  }
  if (aluno && ativo(aluno)) {
    return {
      perfil: 'aluno', bloqueio: null, primeiroAcesso: !!aluno.primeiro_acesso,
      nome: aluno.nome_completo ?? null, professorId: null, tambemAluno: false,
    };
  }
  return {
    perfil: null, bloqueio: aluno || professor ? 'desativado' : 'sem_perfil',
    primeiroAcesso: false, nome: null, professorId: null, tambemAluno: false,
  };
}
