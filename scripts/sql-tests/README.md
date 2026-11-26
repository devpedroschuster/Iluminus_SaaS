# scripts/sql-tests/

Testes SQL do banco. Cada arquivo cria os próprios dados, roda os casos e
**sempre** termina em `RAISE EXCEPTION` com a linha de resultado, então tudo o
que ele faz é desfeito. Rode só no **staging** (`mytmreoqysbxisszludl`), nunca
em produção.

## Como rodar

A partir da raiz do repo, concatene as fixtures (`_fixtures.sql`) e o teste
num arquivo **fora** do repo e rode o resultado:

```sh
cat scripts/sql-tests/_fixtures.sql scripts/sql-tests/<teste>.sql > /tmp/t.sql
supabase db query --linked --project-ref mytmreoqysbxisszludl \
  --output-format text -f /tmp/t.sql
```

Para testar uma migration antes de aplicá-la, ponha a migration antes das
fixtures e envolva tudo em `BEGIN; ... ROLLBACK;`, para o staging ficar
como estava:

```sh
{ echo 'BEGIN;'; cat supabase/migrations/<migration>.sql \
    scripts/sql-tests/_fixtures.sql scripts/sql-tests/<teste>.sql; echo 'ROLLBACK;'; } > /tmp/t.sql
supabase db query --linked --project-ref mytmreoqysbxisszludl \
  --output-format text -f /tmp/t.sql
```

A saída termina com `RESULTADO <NOME>: PASSOU (n/n)` ou
`RESULTADO <NOME>: FALHOU (k falha(s) em n casos): ...` (dentro da mensagem
de erro do `RAISE`). Alguns testes pedem um aluno `admin` com `auth_id` (a
conta E2E de staging): o cabeçalho de cada um diz.

## Fixtures (`_fixtures.sql`)

Só funções em `pg_temp` (somem com a sessão). Os planos do aluno moram em
`planos_aluno` e as modalidades em `alunos_modalidades`: os testes **não**
gravam nas colunas antigas do cadastro (`alunos.plano_id`,
`data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde`,
`modalidades_selecionadas`).

- `pg_temp.teste_aluno_com_plano(p_nome, p_email, p_plano_id, p_inicio, p_fim,
  p_modalidades DEFAULT '{}', p_auth_id DEFAULT NULL, p_ativo DEFAULT true,
  p_pausado_desde DEFAULT NULL, p_role DEFAULT 'aluno', p_bolsista DEFAULT false)`
  devolve `(aluno_id, plano_aluno_id)`. Cria o aluno (`primeiro_acesso = false`),
  um `planos_aluno` com plano, início, fim e pausa, e as modalidades em
  `alunos_modalidades` ligadas a ele, com `vezes` = repetições no array
  (`ARRAY[m, m]` = 2 vezes por semana). Com `p_plano_id` nulo, cria só o aluno.
  Outras colunas do cadastro (telefone, cpf...): `UPDATE alunos` logo depois.

  ```sql
  SELECT t.aluno_id, t.plano_aluno_id INTO v_al, v_pa
    FROM pg_temp.teste_aluno_com_plano('[TESTE X] Aluna', 'teste-x-a@iluminus.test',
                                       v_plano, v_hoje - 30, v_hoje + 60, ARRAY[v_mod],
                                       p_ativo => false) t;
  ```

- `pg_temp.teste_modalidades(p_aluno, p_plano_aluno, p_modalidades)` troca o
  conjunto de modalidades do aluno pelo array (ligadas a `p_plano_aluno`,
  `vezes` = repetições; as que não estão no array são apagadas).

Para ler o plano principal num teste, use
`public._plano_aluno_principal(aluno_id)` (id em `planos_aluno`).

Os testes da cópia no cadastro (`ilu127_planos_aluno_sincronizacao.sql`,
`ilu127_3a_copia_inversa.sql` e `ilu127_4_guarda.sql`) saíram com ela (ILU-127
fase 2); os casos deles que testam comportamento que continua (vínculos de
ciclo, cobrança e pausa ao plano do aluno) estão em
`ilu127_planos_aluno_vinculos.sql`.

## Convenção dos dados de teste

- Nomes com um marcador entre colchetes do teste (`[TESTE X] ...`) e e-mails
  `teste-x-*@iluminus.test`; os testes da remoção das cópias (ILU-127 fase 2)
  usam `[TESTE F2]` e `teste-f2-*@iluminus.test`.
- Um bloco `DO $test$` com um sub-bloco por caso, que termina com o erro
  proposital `SQLSTATE 'TR001'` (desfaz só aquele caso); qualquer outro erro
  vira falha do caso.
- Funções auxiliares de um teste só, em `pg_temp`, no próprio arquivo.
