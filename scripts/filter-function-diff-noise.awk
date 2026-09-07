# Remove blocos "CREATE OR REPLACE FUNCTION ... $function$ ... $function$;"
# do diff da Supabase CLI — usado por check-db-diff.sh para não mascarar
# `supabase db diff` como drift em ~20 funções plpgsql que são
# semanticamente idênticas às da migration, mas que o diff engine
# reserializa com convenção de formatação diferente (ver ILU-57).
#
# Só remove um bloco que comece com "CREATE OR REPLACE FUNCTION" e feche
# com um par completo de "$function$" — uma função genuinamente nova,
# removida, ou com assinatura diferente (emitida como "CREATE FUNCTION" ou
# "DROP FUNCTION" isolado, sem esse par) nunca casa este padrão e continua
# sendo reportada normalmente.
BEGIN { in_func = 0; dollars = 0; after_close = 0 }
{
  line = $0

  if (after_close) {
    after_close = 0
    in_func = 0
    dollars = 0
    next
  }

  if (line ~ /^set check_function_bodies = (on|off);$/) {
    next
  }

  if (!in_func && line ~ /^CREATE OR REPLACE FUNCTION[[:space:]]/) {
    in_func = 1
    dollars = 0
  }

  if (in_func) {
    tmp = line
    n = gsub(/\$function\$/, "", tmp)
    dollars += n
    if (dollars >= 2) {
      after_close = 1
    }
    next
  }

  print line
}
