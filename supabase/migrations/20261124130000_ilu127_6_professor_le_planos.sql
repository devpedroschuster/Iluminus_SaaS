-- ILU-127 (entrega 6): o professor lê os planos e as modalidades dos alunos
-- que já enxerga em alunos. A regra é a mesma de
-- alunos.professor_select_alunos_das_proprias_comissoes: o professor vê o
-- aluno quando tem alguma comissão (repasses_lancamentos) dele. Só leitura:
-- os grants de planos_aluno e alunos_modalidades continuam SELECT para o
-- authenticated, então o professor segue sem escrever.

CREATE POLICY planos_aluno_select_professor ON public.planos_aluno
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.repasses_lancamentos r
      JOIN public.professores p ON p.id = r.professor_id
     WHERE r.aluno_id = planos_aluno.aluno_id
       AND p.auth_id = (SELECT auth.uid())
  ));

CREATE POLICY alunos_modalidades_select_professor ON public.alunos_modalidades
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.repasses_lancamentos r
      JOIN public.professores p ON p.id = r.professor_id
     WHERE r.aluno_id = alunos_modalidades.aluno_id
       AND p.auth_id = (SELECT auth.uid())
  ));
