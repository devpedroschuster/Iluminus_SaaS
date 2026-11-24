-- Down de 20261124130000_ilu127_6_professor_le_planos: o professor volta a
-- não ler planos_aluno nem alunos_modalidades.

DROP POLICY IF EXISTS planos_aluno_select_professor ON public.planos_aluno;
DROP POLICY IF EXISTS alunos_modalidades_select_professor ON public.alunos_modalidades;
