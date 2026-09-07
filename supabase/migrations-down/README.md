# supabase/migrations-down/

Esta pasta guarda, só como documentação/histórico, o SQL que desfaz cada
migration destrutiva aplicada em `supabase/migrations/`. **Nunca** é
executada automaticamente por `supabase db push` nem pelo CI.

## Convenção

- Toda migration destrutiva em
  `supabase/migrations/<timestamp>_<nome>.sql` ganha um arquivo irmão
  aqui: `supabase/migrations-down/<timestamp>_<nome>.sql` (mesmo
  timestamp e nome — só a pasta muda) com o SQL que desfaz exatamente
  essa migration.
- **Nunca colocar o arquivo de "down" dentro de `supabase/migrations/`**
  — o Supabase CLI aplicaria os dois como migrations independentes (a
  "down" rodaria pra frente também, desfazendo a "up" imediatamente).
- Pra aplicar um rollback de verdade num incidente, rode o conteúdo do
  arquivo de "down" manualmente contra o banco:
  `supabase db execute -f supabase/migrations-down/<arquivo>.sql
  --project-ref <ref-de-producao>` (peça confirmação antes — ver
  `CLAUDE.md`) ou cole no SQL Editor do painel Supabase. Não existe um
  comando automático "desfazer última migration".

## Exemplo

Migration "up" que remove uma coluna não usada:
```sql
-- supabase/migrations/20261001120000_drop_coluna_legada_x.sql
ALTER TABLE public.alunos DROP COLUMN IF EXISTS coluna_legada_x;
```

Down correspondente, escrito e revisado **antes** de aplicar a de cima:
```sql
-- supabase/migrations-down/20261001120000_drop_coluna_legada_x.sql
-- Restaura a coluna removida por 20261001120000_drop_coluna_legada_x.sql.
-- Não restaura os DADOS que estavam na coluna — só a estrutura. Se os
-- dados importam, tire backup/snapshot do banco antes de rodar a "up"
-- (ver .github/workflows/db-backup.yml).
ALTER TABLE public.alunos ADD COLUMN IF NOT EXISTS coluna_legada_x text;
```
