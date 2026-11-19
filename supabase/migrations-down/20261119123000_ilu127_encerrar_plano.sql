-- Down de 20261119123000_ilu127_encerrar_plano (ILU-131).
-- Remove encerrar/desfazer/efetivação e o cron, e volta avancar_inicio_plano
-- à versão da ILU-108 (20261117130000). Rodar primeiro (ordem inversa).

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'efetivar-encerramentos';
DROP FUNCTION IF EXISTS public.encerrar_plano_aluno(uuid);
DROP FUNCTION IF EXISTS public.desfazer_encerramento_plano(uuid);
DROP FUNCTION IF EXISTS public.efetivar_encerramentos();
DROP FUNCTION IF EXISTS public._efetivar_encerramento(uuid);

CREATE OR REPLACE FUNCTION public.avancar_inicio_plano()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_n    integer;
BEGIN
  UPDATE alunos a
     SET data_inicio_plano = c.data_inicio
    FROM (SELECT DISTINCT ON (h.aluno_id) h.aluno_id, h.data_inicio
            FROM historico_planos h
            JOIN alunos al ON al.id = h.aluno_id
           WHERE h.status IS DISTINCT FROM 'cancelado'
             AND h.data_inicio <= v_hoje
             AND h.data_inicio > al.data_inicio_plano
             AND h.data_fim = al.data_fim_plano
             AND h.plano_id = al.plano_id
           ORDER BY h.aluno_id, h.data_inicio DESC) c
   WHERE a.id = c.aluno_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
