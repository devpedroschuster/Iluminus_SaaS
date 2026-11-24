-- Down de 20261123120000_ilu127_telas_rpcs (ILU-127, entrega 4).
-- Remove salvar_modalidades_aluno e recalcular_plano_aluno.

DROP FUNCTION IF EXISTS public.salvar_modalidades_aluno(bigint, jsonb);
DROP FUNCTION IF EXISTS public.recalcular_plano_aluno(uuid);
