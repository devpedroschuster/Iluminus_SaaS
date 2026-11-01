-- ILU-29 (Achado 2): mensalidades só armazenavam plano_id, sem congelar o
-- valor devido no momento da criação. Toda tela que mostra o valor de uma
-- mensalidade pendente lê ao vivo planos.preco — como Planos.jsx permite
-- editar esse preço sem histórico, alterar o preço de um plano retroage
-- sobre mensalidades já geradas (e já faturadas) de alunos naquele plano.
--
-- Esta migration adiciona valor_esperado, que passa a ser preenchido no
-- momento da criação de cada mensalidade recorrente (gerarMensalidades,
-- NovoAluno) e não é mais alterado depois. É nullable porque:
--   - linhas pagas continuam usando valor_pago como fonte da verdade;
--   - lançamentos manuais (adicionarPagamentoManual) já gravam o valor em
--     valor_pago mesmo quando pendentes, e nem sempre têm plano_id.
-- O backfill abaixo é best-effort: não existe histórico do preço do plano
-- em cada data de vencimento, então linhas antigas recebem o preço atual do
-- plano — melhor do que ficar nulo, mas pode não refletir o preço vigente
-- na época em que a mensalidade foi originalmente gerada.

ALTER TABLE "public"."mensalidades"
  ADD COLUMN IF NOT EXISTS "valor_esperado" numeric(10,2);

COMMENT ON COLUMN "public"."mensalidades"."valor_esperado" IS
  'Valor devido congelado no momento da criação da mensalidade (preço do plano na época). Usado como valor a receber para linhas pendentes/atrasadas, imune a edições posteriores no preço do plano. NULL em linhas legadas ou em lançamentos manuais sem plano associado.';

UPDATE "public"."mensalidades" m
SET "valor_esperado" = p."preco"
FROM "public"."planos" p
WHERE m."plano_id" = p."id"
  AND m."valor_esperado" IS NULL;
