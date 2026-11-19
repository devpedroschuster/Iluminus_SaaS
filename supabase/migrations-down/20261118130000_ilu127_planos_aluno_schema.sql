-- Down de 20261118130000_ilu127_planos_aluno_schema (ILU-130).
-- Remove os gatilhos, as funções, as colunas plano_aluno_id e as tabelas
-- planos_aluno e alunos_modalidades. O cadastro do aluno (alunos) não foi
-- alterado pela migration, então nada precisa ser restaurado nele.

DROP TRIGGER IF EXISTS trg_alunos_1_sinc_plano ON public.alunos;
DROP TRIGGER IF EXISTS trg_alunos_2_sinc_modalidades ON public.alunos;
DROP TRIGGER IF EXISTS trg_historico_planos_plano_aluno ON public.historico_planos;
DROP TRIGGER IF EXISTS trg_mensalidades_plano_aluno ON public.mensalidades;
DROP TRIGGER IF EXISTS trg_pausas_plano_plano_aluno ON public.pausas_plano;

DROP FUNCTION IF EXISTS public._trg_alunos_sinc_plano();
DROP FUNCTION IF EXISTS public._trg_alunos_sinc_modalidades();
DROP FUNCTION IF EXISTS public._trg_historico_planos_plano_aluno();
DROP FUNCTION IF EXISTS public._trg_mensalidades_plano_aluno();
DROP FUNCTION IF EXISTS public._trg_pausas_plano_plano_aluno();
DROP FUNCTION IF EXISTS public._sinc_modalidades_aluno(bigint, uuid[]);
DROP FUNCTION IF EXISTS public._plano_aluno_principal(bigint);

ALTER TABLE public.pausas_plano     DROP COLUMN IF EXISTS plano_aluno_id;
ALTER TABLE public.mensalidades     DROP COLUMN IF EXISTS plano_aluno_id;
ALTER TABLE public.historico_planos DROP COLUMN IF EXISTS plano_aluno_id;

DROP TABLE IF EXISTS public.alunos_modalidades;
DROP TABLE IF EXISTS public.planos_aluno;
