# Planos do aluno: primeira leva de telas (entrega 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gestão vê e opera cada plano do aluno: renovar, pausar, encerrar, adicionar outro plano, ligar cada modalidade a um plano e escolher o plano de um pagamento manual. O cadastro, a conversão de lead, a lista de alunos, o Dashboard, os avisos de vencimento e o app do aluno passam a ler os planos do aluno. Nenhuma tela grava mais nos campos copiados de `alunos`.

**Architecture:**
- Uma lib pura nova (`lib/planosAluno.js`) concentra a situação por plano, os rótulos e as regras do seletor de plano, com Vitest.
- Os serviços ganham as chamadas por plano. As RPCs da 3a já aceitam `p_plano_aluno_id`/`p_novo_plano`.
- O usuário logado só tem `SELECT` em `planos_aluno` e `alunos_modalidades` (grants da ILU-130). Por isso, as duas escritas que faltam passam por duas RPCs novas: `salvar_modalidades_aluno` e `recalcular_plano_aluno`.
- A correção da ILU-134 (contagem de danças da comissão) vai numa migration própria, decisão do usuário em 2026-11-23: corrigir antes de publicar.
- O fim da sincronização inversa (`alunos` → planos) é uma terceira migration, num segundo PR, aplicada **depois** do deploy do frontend (Task 14).

**Tech Stack:** React 18 + Vite, TanStack Query, Supabase JS, Vitest; PostgreSQL (plpgsql) e Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (5.3, 6.4, 7 item 4, 8, 9). Notas "entrega 4" e "4/5" da descrição da ILU-127 e a ILU-134. As assinaturas do banco vêm dos planos 3a, 3b e 3c em `docs/superpowers/plans/2026-11-19-planos-aluno-*.md`.

## Global Constraints

- **Aluno com um plano só não vê diferença:**
  - o seletor de plano fica oculto e o plano é escolhido sozinho;
  - o app do aluno mostra as mesmas mensagens de hoje;
  - os ids das notificações continuam iguais (`venc-<aluno>-<fim>`, `pausa-<aluno>-<previsão>`), e os resolvidos não voltam;
  - as RPCs só recebem `p_plano_aluno_id` quando ele é informado, então as asserções `toHaveBeenCalledWith` atuais passam sem mudança.
- **Nome do plano** aparece nas telas da gestão e no app só quando o aluno tem mais de um plano válido. Com dois planos de mesmo nome, o rótulo ganha ` (desde DD/MM/AA)`, a partir do `data_inicio`.
- **Plano válido:** `encerrado_em IS NULL OR encerrado_em >= hoje`, com hoje em `America/Sao_Paulo` (`hojeBrasilia()`), a mesma regra de `_resolver_plano_aluno`.
- **Situação de um plano** (`situacaoPlano`):
  - `pausado`: `pausado_desde`;
  - `vencido`: `data_fim < hoje`;
  - `vencendo`: 0 a 7 dias;
  - `em_dia`: mais de 7 dias;
  - `sem_data`: sem `data_fim`.
  - Plano encerrado e ainda válido recebe `encerrando: true`, com o rótulo "Encerra em DD/MM", mas a situação segue o `data_fim`, porque continua contando até o fim (spec 6.2).
  - Um plano que só passou do fim, sem o clique, continua `vencido`, exatamente como hoje.
- **Situação do aluno** (`situacaoAluno`):
  - considera só os planos válidos;
  - a pior situação vence: `vencido`, depois `vencendo`, depois `em_dia`, depois `sem_data`;
  - empate: o plano de `data_fim` mais antigo;
  - `pausado` só quando todos os válidos estão pausados;
  - sem plano válido, `null` ("Sem plano").
- **Seletor de plano** (modalidade e pagamento): a escolha atual, se houver; com um plano válido só, esse; senão, nenhum, e a gestão precisa escolher. Não salva modalidade sem plano, nem cobrança `regular`/`plano_livre` de aluno com mais de um plano sem plano escolhido.
- **Limite das modalidades por plano:**
  - cada plano usa as `regras_acesso` do próprio `planos`;
  - o uso de uma área conta só as modalidades ligadas a esse plano;
  - área sem regra no plano fica bloqueada para ele.
- **Ninguém no frontend grava** `alunos.plano_id`, `data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde` ou `modalidades_selecionadas`, nem insere direto em `historico_planos`. A leitura desses campos continua permitida nas telas da segunda leva.
- **Mensagens novas** (exatas):
  - "Escolha o plano de cada modalidade.";
  - "Escolha o plano do aluno.";
  - "Cadastre um plano antes de escolher as modalidades.".
- **Banco:**
  - toda migration tem down em `supabase/migrations-down/` e teste em `scripts/sql-tests/` no formato da ILU-127 (`DO $test$`, sub-blocos `TR001`, `RESULTADO <NOME>: PASSOU (n/n)`, dados `[TESTE 4]`, e-mails `teste-4-*@iluminus.test`);
  - rodar no staging com `supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f <arquivo>`, concatenando antes as migrations ainda não aplicadas;
  - produção (`spmvrzftyqxalprpceqn`) **só com o OK explícito do usuário**, antes do merge.
  - Projetos: produção `spmvrzftyqxalprpceqn`, staging `mytmreoqysbxisszludl`. Rodar `vercel whoami` antes de qualquer comando Vercel.

## Escritores dos campos copiados (spec 5.3, grep de 2026-11-23)

Banco: só `_copiar_plano_para_cadastro`, conferido em `pg_proc` na produção. Edge Functions: nenhum. Frontend:

| # | Onde | Grava | Destino nesta entrega |
|---|---|---|---|
| 1 | `NovoAluno.jsx` `onSubmit`, criação e conversão de lead | `alunos` com plano, datas e modalidades; `historico_planos` e `mensalidades` direto (`criarRegistrosFinanceiros`) | `criarPrimeiroPlano` (Task 9) |
| 2 | `NovoAluno.jsx` `onSubmit`, edição | `modalidades_selecionadas`, `data_inicio_plano`, `data_fim_plano` | saem do formulário de edição (Task 9) |
| 3 | `PerfilAluno.jsx` `AbaModalidades` | `modalidades_selecionadas` | `salvar_modalidades_aluno` (Task 7) |
| 4 | `PerfilAluno.jsx` `ModalEditarHistoricoPlano` | `plano_id`, `data_inicio_plano`, `data_fim_plano` (`camposDoPlanoNoCadastro`) | `recalcular_plano_aluno` (Task 6) |
| 5 | `alunosService.normalizarHistoricoPlanos` | `historico_planos`; sem chamadores | removido (Task 5) |

`AreaAluno` grava só dados pessoais (`montarAtualizacaoPerfil`), e `definirBolsista`/`alterarStatus` gravam outras colunas. Nenhum deles muda.

**Sincronização inversa (decisão):**
- Saem os gatilhos `trg_alunos_1_sinc_plano` e `trg_alunos_2_sinc_modalidades`. No lugar deles entra uma guarda que **recusa** a escrita direta nos cinco campos de aluno que tem `planos_aluno`. Com isso, a tela velha aberta numa aba esquecida dá erro em vez de ser desfeita em silêncio.
- Isso vai numa migration **posterior ao deploy** (Task 14), porque o frontend atual ainda grava esses campos até o merge.
- Os gatilhos `BEFORE INSERT` que preenchem `plano_aluno_id` nulo em `historico_planos`, `mensalidades` e `pausas_plano` ficam, como valor padrão. Eles não tocam nas cópias e saem junto com elas na entrega 6.

## Review Focus

1. **Aluno de um plano em todas as telas:** seletor oculto, sem campo novo no pagamento, mensagens do app e ids de notificação iguais aos de hoje. Testes `planosAluno.test.js` (U1–U3), `agendaAluno.test.js` (A1) e `useNotificacoes` (N1).
2. **Cadastro que falha no meio** (aluno salvo, plano não): o "Tentar novamente" não cria um segundo plano. Teste `criarPrimeiroPlano` (CP3).
3. **Modalidade ligada a plano de outro aluno, ou a plano já encerrado e efetivado:** a RPC recusa (teste SQL M3/M4), e a tela não oferece esse plano (teste S4).
4. **Pagamento manual de aluno com dois planos:** sem plano escolhido, não salva; as cobranças em aberto e o ciclo "cobre o ciclo inteiro" vêm só do plano escolhido. Testes F1–F3.
5. **Plano encerrado pela gestão:** antes do fim, aparece como "Encerra em DD/MM" e conta na situação; depois do fim, sai da lista, do Dashboard e dos avisos. Plano que só passou do fim continua "vencido". Testes S5–S7.

---

### Task 1: Worktree, issue e plano

- [ ] **Step 1:** Confirmar que o worktree `claude/ilu-telas-varios-planos-3b0f9f` está em `origin/main` (`8dea72e` em 2026-11-23); se não, rebasear. Copiar `gestao_web/.env.local` da pasta principal para o worktree (aponta para o staging; não é commitado).
- [ ] **Step 2:** Confirmar que o staging tem as migrations até `20261119140000`: `supabase migration list --linked --project-ref mytmreoqysbxisszludl`. Se faltar alguma, parar e avisar.
- [ ] **Step 3:** Criar no Linear (time Iluminus) a sub-issue de ILU-127 "Telas para vários planos por aluno (entrega 4)", com link para este plano e a lista de escritores acima. Usar URLs completas do GitHub, nunca "PR #N". O workspace bateu o limite de issues do plano gratuito na 3c; se a criação falhar, registrar as mesmas notas numa seção "Entrega 4" da descrição da ILU-127 e avisar o usuário.
- [ ] **Step 4:** Commit do plano: `docs: plano da entrega 4 de ILU-127 (telas por plano)`.

### Task 2: RPCs de escrita (modalidades e recálculo do plano)

**Files:**
- Create: `supabase/migrations/20261123120000_ilu127_telas_rpcs.sql` + down (remove as duas funções)
- Create: `scripts/sql-tests/ilu127_4_rpcs.sql`

**Interfaces:**
- Produces:
  - `public.salvar_modalidades_aluno(p_aluno_id bigint, p_itens jsonb) RETURNS integer` (linhas gravadas). `SECURITY DEFINER`, `SET search_path = ''`, só admin (mesma checagem de `renovar_plano_aluno`) ou `service_role`. `GRANT EXECUTE` a `authenticated, service_role`; `REVOKE` de `PUBLIC, anon`.
    - `p_itens`: `[{ "modalidade_id": uuid, "vezes": int, "plano_aluno_id": uuid }]`. Substitui o conjunto inteiro do aluno numa transação: apaga as linhas fora da lista e faz upsert das outras (`ON CONFLICT (aluno_id, modalidade_id) DO UPDATE SET vezes, plano_aluno_id`). A cópia em `alunos.modalidades_selecionadas` vem do gatilho da 3a.
    - Recusas, sem gravar nada:
      - `plano_aluno_id` nulo → "Escolha o plano de cada modalidade.";
      - plano de outro aluno, ou com `encerramento_efetivado` → "Plano do aluno não encontrado.";
      - `vezes < 1` → "Quantidade de vezes inválida.";
      - modalidade repetida na lista ou inexistente → "Modalidade inválida.".
  - `public.recalcular_plano_aluno(p_plano_aluno_id uuid) RETURNS void`, com o mesmo acesso. Refaz `plano_id`, `data_inicio` e `data_fim` do plano a partir dos ciclos dele que não estão `cancelado`, pela regra de `camposDoPlanoNoCadastro` (`gestao_web/src/lib/utils.js:142`):
    - o vigente é o ciclo que cobre hoje; senão, o de `data_inicio` mais recente;
    - o início vem do vigente;
    - se o vigente cobre hoje, plano e fim vêm do ciclo de início mais recente; senão, do vigente;
    - sem ciclos, não muda nada;
    - "Plano do aluno não encontrado." se não existir.

- [ ] **Step 1: Escrever `ilu127_4_rpcs.sql`:**

  | Caso | Faz | Espera |
  |---|---|---|
  | M1 | aluno com planos A e B; salvar `[X×2→A, Z×1→B]` | `alunos_modalidades` = X(2,A), Z(1,B); `alunos.modalidades_selecionadas` = `{X,X,Z}` em ordem de `modalidade_id` |
  | M2 | salvar de novo `[Z×1→A]` | X sai; Z passa para A |
  | M3 | item com plano de outro aluno | recusa "Plano do aluno não encontrado."; nada muda |
  | M4 | item com B encerrado e efetivado | mesma recusa |
  | M5 | item com `plano_aluno_id` nulo; `vezes = 0`; modalidade repetida | as três mensagens; nada muda |
  | M6 | `[]` | apaga tudo; o array fica `{}` |
  | M7 | como aluno (`authenticated`, não admin) | recusa por permissão |
  | R1 | plano com ciclo vigente (hoje dentro) e ciclo seguinte agendado; editar o vigente e chamar `recalcular_plano_aluno` | início do vigente; plano e fim do agendado |
  | R2 | aluno com A e B; recalcular B depois de mudar o fim do ciclo de B | só B muda; o cadastro (cópia de A) continua igual |

- [ ] **Step 2:** Staging sem a migration. Esperado: FALHOU (função inexistente no primeiro sub-bloco).
- [ ] **Step 3:** Escrever a migration e a down.
- [ ] **Step 4:** Staging com a migration (concatenada): `ilu127_4_rpcs` PASSOU; todos os outros `scripts/sql-tests/*.sql` com o mesmo resultado da base (rodar a base antes). Depois a down, mais `ilu127_planos_aluno_invariantes`. Esperado: PASSOU.
- [ ] **Step 5:** Commit `feat(db): salvar modalidades e recalcular plano do aluno por RPC (ILU-127 4)`.

### Task 3: Contagem de danças da comissão (ILU-134)

**Files:**
- Create: `supabase/migrations/20261123121000_ilu134_contagem_dancas.sql` + down (recria `_apurar_repasses` como em `20261119140000_ilu127_repasses_por_plano.sql`)
- Create: `scripts/sql-tests/ilu134_contagem_dancas.sql`

**Interfaces:**
- Produces: `_apurar_repasses` (mesma assinatura e ACL), partindo da versão da 3c. Só mudam estes pontos:
  1. **Achado 1 (o pedido):** `n_danca_com_professor` passa a contar as modalidades distintas, com professor e área diferente de `'Funcional'`, de dois grupos:
     - as cobertas no mês, que é a conta de hoje;
     - as ligadas (`alunos_modalidades`) a **outro** plano regular do aluno com estado `sem_cobertura` no mês, válido no mês: `encerrado_em IS NULL OR encerrado_em >= v_mes`, `data_inicio` até o fim do mês e plano atual com `is_plano_livre = false`.
     - Planos pausados ou livres não entram. Com um plano só, o segundo grupo é vazio e o resultado é o de hoje.
  2. **Achado 2:** em `frequentadas`, a modalidade ligada a outro plano só fica de fora quando esse plano tem fonte no mês (`EXISTS` em `fontes` com aquele `plano_aluno_id`).
  3. **Achado 3:** em `livre_bloqueado`, `existe` só olha as comissões gravadas das modalidades que `frequentadas` atribuiu a esse plano livre.
  - Os achados 2 e 3 também ficam alcançáveis pela tela desta entrega (religar modalidade e criar um segundo plano). Por isso vêm junto. Se o usuário preferir só o 1, eles viram um item da ILU-134 e saem deste task.

- [ ] **Step 1: Escrever `ilu134_contagem_dancas.sql`** (competência dezembro de 2026, depois de `regra_danca_desde`):

  | Caso | Faz | Espera |
  |---|---|---|
  | D1 | planos A (Dança 1) e B (Dança 2); paga A no dia 5 e apura; paga B no dia 20 e apura | Dança 1 = 70 e Dança 2 = 70 |
  | D2 | a mesma coisa, pagando B antes de A | 70 + 70 |
  | D3 | B pausado no mês inteiro; paga A | Dança 1 = 100 |
  | D4 | B é plano livre | Dança 1 = 100 |
  | D5 | B com `encerrado_em` antes do mês | Dança 1 = 100 |
  | D6 | B com Treinamento Físico (Funcional) | Dança 1 = 100; TF = 100 quando pago |
  | D7 | um plano só, cobrança com `modalidade_id` de uma das duas danças | igual a hoje (100 na coberta) |
  | L1 | plano livre L com D1 frequentada; D1 religada a um plano novo B, sem fonte, antes do dia 1 | D1 continua gerada no livre (R$ 120 no cenário da ILU-134) |
  | L2 | dois planos livres; L1 grava, L2 pago depois | as linhas de L2 são gravadas (não `ja_existia`) |

- [ ] **Step 2:** Staging sem a migration. Esperado: FALHOU em D1/D2/L1/L2, e D3–D7 PASSOU.
- [ ] **Step 3:** Escrever a migration e a down, com `diff` contra a 3c mostrando só os três pontos.
- [ ] **Step 4:** Staging com as migrations das Tasks 2 e 3: o teste novo PASSOU, e **todos** os outros iguais à base, em especial `comissao_valor_dancas`, `repasses_competencia`, `ilu125_a_vista_no_recebimento` e os `ilu127_3c_*`. Depois as downs em ordem inversa, mais `repasses_competencia`. Esperado: PASSOU.
- [ ] **Step 5:** Commit `fix(db): danças de planos ainda não pagos contam para o R$ 70 (ILU-134)`.

### Task 4: Lógica dos planos do aluno (lib pura)

**Files:**
- Create: `gestao_web/src/lib/planosAluno.js`
- Create: `gestao_web/src/lib/planosAluno.test.js`

**Interfaces:**
- Produces (todas puras; datas `'AAAA-MM-DD'`; `hoje` sempre parâmetro). Um plano do aluno tem a forma `{ id, plano_id, data_inicio, data_fim, pausado_desde, encerrado_em, encerramento_efetivado, created_at, planos: { nome, regras_acesso, is_plano_livre, preco, duracao_meses } }`.
  - `planosValidos(planos, hoje) → plano[]`, em ordem `(created_at, id)`.
  - `situacaoPlano(plano, hoje) → { codigo: 'pausado'|'vencido'|'vencendo'|'em_dia'|'sem_data', dias: number|null, encerrando: boolean, rotulo: string, tone: 'info'|'destructive'|'warning'|'success'|'neutral' }`. Rótulos:
    - "Pausado desde DD/MM";
    - "Venceu há N dia(s)";
    - "Vence hoje" / "Vence em N dia(s)";
    - "Em dia";
    - "Sem data";
    - com `encerrando`, o rótulo vira "Encerra em DD/MM" e o tone `neutral`, exceto quando vencido.
  - `situacaoAluno(planos, hoje) → { plano, situacao, varios: boolean } | null` (Global Constraints).
  - `rotuloPlanoAluno(plano, planosDoAluno) → string`.
  - `planoSugerido(planosValidosDoAluno, atual) → uuid|null` (Global Constraints, "Seletor").
  - `usoPorPlanoEArea(contagem, planoPorModalidade, areaPorModalidade) → Map<planoId, Map<area, n>>`. `contagem` é `{ [modalidadeId]: vezes }`.
  - `validarModalidades({ contagem, planoPorModalidade, planos, areaPorModalidade }) → string|null`. Devolve a primeira mensagem:
    - plano faltando → "Escolha o plano de cada modalidade.";
    - área sem regra no plano → "O plano <rótulo> não inclui <área>.";
    - acima do limite → "O plano <rótulo> permite <n>x em <área>.";
    - limite 999 = sem limite.
  - `montarItensModalidades(contagem, planoPorModalidade) → { modalidade_id, vezes, plano_aluno_id }[]`, só com `vezes > 0`.
  - `notificacoesDeVencimento(linhas, hoje) → notificacao[]`. `linhas` vem de `planos_aluno` com `alunos(id, nome_completo, telefone, ativo)`:
    - janela de −60 a +7 dias, como hoje;
    - pula pausado, plano não válido e aluno inativo;
    - `idUnico`: `venc-<alunoId>-<data_fim>` quando o aluno tem um plano válido, ou `venc-<alunoId>-<planoAlunoId>-<data_fim>` quando tem vários;
    - `aluno.planos.nome` = rótulo do plano, para a tela de notificações continuar lendo o mesmo caminho.

- [ ] **Step 1: Escrever os testes** (`describe('planosAluno')`, hoje = `'2026-11-23'`):
  - **U1:** um plano → `planoSugerido([A], null) === A.id`; `situacaoAluno([A]).varios === false`; `rotuloPlanoAluno(A, [A]) === A.planos.nome`.
  - **U2:** `notificacoesDeVencimento` de um aluno com um plano vencendo em 2026-11-25 → `idUnico === 'venc-10-2026-11-25'`, `diasFaltando === 2`.
  - **U3:** dois planos → os ids levam o id do plano, e `aluno.planos.nome` é o nome de cada plano.
  - **S1:** `situacaoPlano` de cada código nas bordas: fim = hoje → `vencendo`, "Vence hoje"; fim = hoje+7 → `vencendo`; fim = hoje+8 → `em_dia`; fim = hoje−1 → `vencido`, "Venceu há 1 dia"; pausado vence o vencido.
  - **S2:** `situacaoAluno`: `[em_dia, vencido]` → vencido com o plano dele; `[vencendo(+5), vencendo(+2)]` → o de +2; `[pausado, em_dia]` → em_dia; `[pausado, pausado]` → pausado.
  - **S3:** dois planos "2x Dança" → rótulos "2x Dança (desde 01/09/26)" e "2x Dança (desde 01/11/26)".
  - **S4:** `planoSugerido([A, B], null) === null`; `planoSugerido([A, B], B.id) === B.id`; `planoSugerido([A], X.id)` com X fora da lista → `A.id`.
  - **S5:** plano com `encerrado_em = hoje+10`, `data_fim = hoje+10` → válido, `encerrando`, "Encerra em 03/12".
  - **S6:** `encerrado_em = hoje−1` → fora de `planosValidos`, de `situacaoAluno` (aluno só com ele → `null`) e das notificações.
  - **S7:** plano sem encerramento com fim hoje−30 → continua `vencido` e na notificação (`diasFaltando === -30`).
  - **V1:** `validarModalidades` com X(Dança)×2 em A (regra Dança limite 2) e Z(Funcional)×1 em B (regra Funcional 1) → `null`; X×3 → "O plano <A> permite 2x em Dança."; Z ligado a A (sem Funcional) → "O plano <A> não inclui Funcional."; X sem plano → "Escolha o plano de cada modalidade.".
  - **V2:** dois planos de Dança com limite 1 cada, X em A e Y em B → `null` (limites independentes).
  - **V3:** `montarItensModalidades({X:2, Y:0}, {X:A})` → `[{ modalidade_id: X, vezes: 2, plano_aluno_id: A }]`.
- [ ] **Step 2:** `npx vitest run src/lib/planosAluno.test.js` (em `gestao_web`). Esperado: FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar `planosAluno.js`. Datas com `hojeBrasilia()` só nos chamadores; contas de dias como em `pausaPlano.js` (meio-dia UTC).
- [ ] **Step 4:** Rodar de novo. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(web): lógica de situação e seletor dos planos do aluno (ILU-127 4)`.

### Task 5: Serviços por plano

**Files:**
- Modify: `gestao_web/src/services/alunosService.js`, `gestao_web/src/services/financeiroService.js`
- Test: `gestao_web/src/services/alunosService.test.js`, `gestao_web/src/services/financeiroService.test.js`

**Interfaces:**
- Consumes: `montarItensModalidades` (Task 4); RPCs da Task 2.
- Produces (`alunosService`):
  - `listarPlanosDoAluno(alunoId)`: `planos_aluno` com `id, plano_id, data_inicio, data_fim, pausado_desde, encerrado_em, encerramento_efetivado, created_at, planos(nome, regras_acesso, is_plano_livre, preco, duracao_meses)`, em ordem `created_at, id`.
  - `listarModalidadesLigadas(alunoId)`: `alunos_modalidades(modalidade_id, vezes, plano_aluno_id)`.
  - `salvarModalidades(alunoId, itens)`: rpc `salvar_modalidades_aluno` com `{ p_aluno_id, p_itens }`.
  - `encerrarPlano(planoAlunoId)`: rpc `encerrar_plano_aluno`.
  - `desfazerEncerramento(planoAlunoId)`: rpc `desfazer_encerramento_plano`.
  - `recalcularPlanoAluno(planoAlunoId)`: rpc `recalcular_plano_aluno`.
  - `renovarPlano(alunoId, dados)`: acrescenta `p_plano_aluno_id` quando `dados.plano_aluno_id`, e `p_novo_plano: true` quando `dados.novo_plano`. O retorno ganha `plano_aluno_id`.
  - `pausarPlano`, `retomarPlano(alunoId, dados)` e `ajustarPrevisaoPausa(alunoId, dataPrevista, planoAlunoId)`: `p_plano_aluno_id` só quando informado.
  - `buscarResumoFrequencia(alunoId, planoAlunoId)`: `p_plano_aluno_id` só quando informado.
  - `criarPrimeiroPlano(alunoId, { plano_id, data_inicio, data_fim, valor_pago, forma_recebimento, modalidades })` → `{ plano_aluno_id, mensalidade_id }`. É idempotente:
    - lista os planos do aluno;
    - se não houver nenhum, chama `renovarPlano(…, { novo_plano: true })`; se houver, usa o primeiro, sem nova cobrança;
    - depois chama `salvarModalidades` com tudo ligado a esse plano (`modalidades` é o `{ [id]: vezes }` do formulário).
  - Remove `normalizarHistoricoPlanos`.
- Produces (`financeiroService`):
  - `listarCobrancasPlanoEmAberto(alunoId, inicio, fim, planoAlunoId)` e `buscarCicloDoVencimento(alunoId, vencimento, planoAlunoId)`: com o id, `.eq('plano_aluno_id', …)`.
  - `adicionarPagamentoManual(dados)`: o payload leva `plano_aluno_id: dados.plano_aluno_id || null` em `regular`/`plano_livre`.
  - `SELECT_MENSALIDADE` ganha `plano_aluno:plano_aluno_id (id, data_inicio, planos (nome))`.

- [ ] **Step 1: Testes:**
  - os atuais de pausa/renovação continuam iguais;
  - novos:
    - `renovarPlano` com `plano_aluno_id` manda `p_plano_aluno_id`, e com `novo_plano` manda `p_novo_plano: true`;
    - `salvarModalidades` manda `p_itens`;
    - `pausarPlano` com `plano_aluno_id` manda `p_plano_aluno_id`;
    - **CP1:** `criarPrimeiroPlano` sem planos → rpc `renovar_plano_aluno` com `p_novo_plano: true` e depois `salvar_modalidades_aluno` com o `plano_aluno_id` devolvido;
    - **CP2:** falha no `salvar` → rejeita com a mensagem do servidor;
    - **CP3:** com um plano já existente → **não** chama `renovar_plano_aluno`, só `salvar_modalidades_aluno` com esse plano;
    - **F1:** `adicionarPagamentoManual` regular com `plano_aluno_id` → payload com ele; avulsa → sem ele;
    - **F2:** `listarCobrancasPlanoEmAberto(…, 'pa1')` filtra por `plano_aluno_id`;
    - **F3:** `buscarCicloDoVencimento(…, 'pa1')` filtra por `plano_aluno_id`.
- [ ] **Step 2:** `npx vitest run src/services`. Esperado: os novos FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS, todos.
- [ ] **Step 5:** Commit `feat(web): serviços por plano do aluno (ILU-127 4)`.

### Task 6: Perfil — aba "Planos" com cartões

**Files:**
- Create: `gestao_web/src/components/aluno/PlanosDoAluno.jsx` (cartões e ações)
- Modify: `gestao_web/src/pages/PerfilAluno.jsx`, `gestao_web/src/components/ModalRenovarPlano.jsx`, `gestao_web/src/components/ModalPausaPlano.jsx`, `gestao_web/src/lib/pausaPlano.js` (`consultasAfetadasPelaPausa` ganha `'aluno-planos-aluno'`)

**Interfaces:**
- Consumes: `situacaoPlano`, `planosValidos`, `rotuloPlanoAluno` (Task 4); serviços da Task 5. Query `['aluno-planos-aluno', id]` → `listarPlanosDoAluno`.
- Produces:
  - `ModalRenovarPlano({ isOpen, onClose, alunoId, planoAluno, novoPlano, onSucesso })`:
    - com `planoAluno`, o início sugerido é `planoAluno.data_fim + 1` (não lê mais `alunos.data_fim_plano`), e o título é "Renovar <rótulo>";
    - com `novoPlano`, o início é hoje e o título é "Adicionar plano";
    - manda `plano_aluno_id` ou `novo_plano`.
  - `ModalPausarPlano`, `ModalRetomarPlano` e `ModalAjustarPrevisao` recebem `planoAluno`:
    - datas e fim vêm dele, não de `aluno.*`;
    - as cobranças listadas filtram por `planoAluno.id`;
    - mandam `plano_aluno_id`;
    - a descrição do modal leva o rótulo do plano quando há vários.

Desenho, aprovado pelo usuário em 2026-11-23 ("Cartões na aba Planos"):
- A aba `planos` muda o rótulo de "Histórico" para "Planos".
- No topo: título "Planos do aluno" e o botão `brand` "+ Adicionar outro plano" (abre `ModalRenovarPlano` com `novoPlano`).
- Uma grade `md:grid-cols-2` com um `Surface variant="card" padding="lg"` por plano válido. Cada cartão tem:
  - o rótulo do plano;
  - o `Badge` da situação (tone de `situacaoPlano`) e o `Badge` da forma de recebimento do ciclo vigente desse plano (`derivarPlanoVigente` dos ciclos com o mesmo `plano_aluno_id`; "À vista"/"Recorrente", como na tabela de hoje);
  - "Ciclo DD/MM/AA – DD/MM/AA" e "Vence DD/MM/AA";
  - as ações em `Button size="sm"`:
    - "Renovar" (`brand`; desabilitado quando pausado, com `title` "Retome o plano antes de renovar");
    - "Pausar", ou "Retomar" e "Ajustar previsão" quando pausado (`outline`);
    - "Encerrar plano" (`ghost`), que confirma com `ModalConfirmacao` (`tipo="warning"`): "O plano <rótulo> vale até DD/MM/AA. Depois disso ele sai dos avisos, e as modalidades e horários fixos dele são liberados. Cobranças em aberto com vencimento depois dessa data são removidas.";
    - "Desfazer encerramento" no lugar de Encerrar quando `encerrando`.
- Planos já efetivados (`encerramento_efetivado`, ou `encerrado_em < hoje`) ficam numa lista "Planos encerrados", com rótulo, fim e "Renovar", que reabre o plano.
- Sem nenhum plano, aparece o estado vazio "Nenhum plano cadastrado" com o mesmo botão.
- Abaixo, "Histórico de ciclos": a tabela atual ganha a coluna "Plano do aluno" (rótulo) só quando há mais de um plano, e o mesmo vale para a tabela "Pausas do plano".
- No cabeçalho, o `Badge` "Plano pausado" e o `AvisoPlanoPausado` passam a ser um por pausa aberta, com o rótulo do plano quando há vários. Retomar/Ajustar abrem o modal daquele plano.
- O nome no cartão superior e `CardUsoPlan`/`HeatmapFrequencia` usam os ciclos do **principal** (primeiro de `planosValidos`). Com mais de um, aparece `+N plano(s)` ao lado do nome.
- `ModalEditarHistoricoPlano`: no lugar de `camposDoPlanoNoCadastro` + `update alunos`, chama `recalcularPlanoAluno(registro.plano_aluno_id)`. `camposDoPlanoNoCadastro` sai de `utils.js` (e do teste) se ficar sem uso. O aviso "Histórico de plano não registrado" passa a valer para plano do aluno sem ciclo.
- O estado de navegação `abrirRenovarPlano` passa a abrir só a aba `planos` (com vários planos não há um só para renovar).

- [ ] **Step 1:** Implementar `PlanosDoAluno.jsx` e as mudanças nos modais e no perfil.
- [ ] **Step 2:** `npm run build` e `npx vitest run` em `gestao_web`. Esperado: build sem erro; testes verdes.
- [ ] **Step 3:** Commit `feat(web): aba Planos com renovar, pausar e encerrar por plano (ILU-127 4)`.

### Task 7: Aba Modalidades com seletor de plano

**Files:**
- Modify: `gestao_web/src/pages/PerfilAluno.jsx` (`AbaModalidades`)

**Interfaces:**
- Consumes: `planosValidos`, `planoSugerido`, `validarModalidades`, `montarItensModalidades`, `usoPorPlanoEArea`, `rotuloPlanoAluno` (Task 4); `listarModalidadesLigadas` e `salvarModalidades` (Task 5).
- O estado deixa de ser o array `modalidades_selecionadas` e passa a ser `contagem` (`{ id: vezes }`) mais `planoPorModalidade` (`{ id: planoAlunoId }`), carregados de `alunos_modalidades`.
- **Um plano válido:** a tela fica como hoje (regras do plano, `+`/`−`, limites), sem seletor, e tudo vai para esse plano.
- **Vários:**
  - o quadro "Regras do Plano" vira um quadro por plano, com o uso daquele plano;
  - cada modalidade ativa (`vezes > 0`) ganha um `select` "Plano", com as opções de `planosValidos` e o valor de `planoSugerido`, mais "Escolha o plano…" quando não há sugestão;
  - o `+` fica liberado quando algum plano válido tem regra para a área;
  - o bloqueio por limite é feito pelo `validarModalidades` no salvar, que mostra a mensagem no toast.
- **Sem plano válido:** aviso "Cadastre um plano antes de escolher as modalidades.", botões desabilitados e salvar oculto. Modalidades que ainda estejam ligadas a um plano encerrado e não efetivado continuam visíveis, com o rótulo dele.
- Salvar: `validarModalidades` → `salvarModalidades` → invalida `['aluno', id]` e `['aluno-modalidades', id]`.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): modalidades ligadas a um plano do aluno (ILU-127 4)`.

### Task 8: Financeiro do aluno e pagamento manual

**Files:**
- Modify: `gestao_web/src/components/financeiro/TabelaMensalidades.jsx`, `gestao_web/src/components/financeiro/AbaFinanceiroAluno.jsx`, `gestao_web/src/components/ModalAdicionarPagamentoManual.jsx`, `gestao_web/src/components/financeiro/useCoberturaDoCiclo.js`

**Interfaces:**
- Consumes: `planoSugerido`, `planosValidos`, `rotuloPlanoAluno` (Task 4); `listarPlanosDoAluno` e os filtros por plano da Task 5.
- `TabelaMensalidades` ganha a prop `rotuloPlano?: (item) => string|null`. Quando ela vem, a coluna "Referência" mostra, embaixo, `Badge tone="neutral"` com o rótulo. `AbaFinanceiroAluno` passa a prop só quando o aluno tem mais de um plano (válido ou não), e o rótulo vem de `item.plano_aluno`.
- `ModalAdicionarPagamentoManual`:
  - com aluno escolhido e `tipo_aula` `regular` ou `plano_livre`, carrega os planos do aluno;
  - com mais de um válido, mostra o `select` "Plano do aluno" (obrigatório; sem ele, `showToast.error('Escolha o plano do aluno.')` e não salva); com um, escolhe sozinho e não mostra nada;
  - escolher o plano preenche `plano_id` com o `plano_id` dele (em vez de `alunos.plano_id`);
  - as cobranças em aberto (`listarCobrancasEmAbertoDoAluno`) mostradas são só as desse plano;
  - `useCoberturaDoCiclo` recebe `planoAlunoId` e o repassa a `buscarCicloDoVencimento`;
  - o payload leva `plano_aluno_id`.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): cobranças e pagamento manual por plano do aluno (ILU-127 4)`.

### Task 9: Cadastro e conversão de lead pelo caminho novo

**Files:**
- Modify: `gestao_web/src/pages/NovoAluno.jsx`

**Interfaces:**
- Consumes: `criarPrimeiroPlano` (Task 5).
- **Criação** (inclusive conversão de lead e professor já existente):
  - o `insert` em `alunos` vai **sem** `plano_id`, `data_inicio_plano`, `data_fim_plano` e `modalidades_selecionadas`;
  - com plano escolhido, chama `criarPrimeiroPlano(novoAlunoId, { plano_id, data_inicio: data_inicio_plano, data_fim: data_fim_plano, valor_pago: <valorCiclo de hoje>, forma_recebimento, modalidades })`;
  - `criarRegistrosFinanceiros` sai. `avisarFalhaFinanceira` passa a refazer `criarPrimeiroPlano`, que é idempotente.
  - **Datas:** o vencimento da primeira cobrança é o início do plano, como em `renovar_plano_aluno`. "Início do Contrato" fica só leitura na criação, espelhando "Data do 1º Pagamento", que já é espelhado hoje (ILU-30).
- **Edição:** `PlanoSlots` e as modalidades saem do formulário de edição, e o payload deixa de levar os cinco campos. No lugar deles, um texto e dois botões:
  - texto: "Planos e modalidades ficam no perfil do aluno.";
  - "Abrir planos": `navigate('/alunos/<id>', { state: { abrirRenovarPlano: true } })`, que abre a aba Planos;
  - "Abrir modalidades": o mesmo, com `state: { aba: 'modalidades' }`. `PerfilAluno` lê `location.state.aba`.
- Assim, nenhuma tela grava os campos copiados. Esse era o caminho que desfazia em silêncio a edição do aluno com dois planos.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): cadastro e conversão de lead criam o primeiro plano do aluno (ILU-127 4)`.

### Task 10: Situação por plano na lista, no Dashboard e nos avisos

**Files:**
- Modify: `gestao_web/src/services/alunosService.js` (`listar`), `gestao_web/src/pages/Alunos.jsx`, `gestao_web/src/services/dashboardService.js`, `gestao_web/src/pages/Dashboard.jsx`, `gestao_web/src/hooks/useNotificacoes.js`, `gestao_web/src/lib/pausaPlano.js` (`notificacoesDePausa`)
- Test: `gestao_web/src/services/dashboardService.test.js`, `gestao_web/src/lib/pausaPlano.test.js`

**Interfaces:**
- Consumes: `situacaoAluno`, `notificacoesDeVencimento`, `rotuloPlanoAluno` (Task 4).
- `alunosService.listar`: o select ganha `planos_aluno(id, plano_id, data_inicio, data_fim, pausado_desde, encerrado_em, encerramento_efetivado, created_at, planos(nome))`.
- `Alunos.jsx`:
  - a coluna Vencimento usa `situacaoAluno(aluno.planos_aluno, hojeBrasilia())`, com o mesmo visual de hoje (Badge com a data, dias em atraso/faltando, "Pausado desde");
  - com `varios`, mostra o rótulo do plano embaixo;
  - a coluna Plano mostra o rótulo do principal, e `+N` com vários;
  - `calcularStatusVencimento` passa a usar `hojeBrasilia()`.
- `dashboardService.obterAlunosPlanosVencendo(hojeIso, limiteIso)`:
  - lê `planos_aluno` com `alunos!inner(id, nome_completo, ativo, role)`;
  - filtros: `ativo` e `role = 'aluno'`, `pausado_desde IS NULL`, `data_fim` entre hoje e o limite, e `encerrado_em IS NULL OR encerrado_em >= hoje`;
  - devolve `[{ id: alunoId, nome_completo, data_fim_plano, plano_nome }]`, com uma linha por plano; `plano_nome` só quando o aluno tem mais de um plano válido;
  - o `Dashboard` mostra "<nome> · <plano_nome>" quando vier.
- `useNotificacoes`:
  - o vencimento vem de `planos_aluno` (com `alunos(id, nome_completo, telefone, data_nascimento, ativo)`) via `notificacoesDeVencimento`;
  - o aniversário continua lendo `alunos`;
  - a pausa: `pausas_plano` ganha `plano_aluno_id, planos_aluno(planos(nome))`, e `notificacoesDePausa` leva o rótulo em `aluno.planos.nome` quando o aluno tem mais de uma pausa aberta. O id continua `pausa-<aluno>-<previsão>`, e com vários planos ganha `-<planoAlunoId>`.

- [ ] **Step 1: Testes:**
  - **N1** (`pausaPlano.test.js`): uma pausa aberta → id `pausa-10-2026-11-20`, igual a hoje; duas pausas de planos diferentes do mesmo aluno → ids com o plano;
  - `dashboardService.test.js`: `obterAlunosPlanosVencendo` consulta `planos_aluno`, aplica os filtros e põe `plano_nome` só para quem tem vários.
- [ ] **Step 2:** `npx vitest run`. Esperado: os novos FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx vitest run` e `npm run build`. Esperado: verde.
- [ ] **Step 5:** Commit `feat(web): situação por plano na lista, no Dashboard e nos avisos (ILU-127 4)`.

### Task 11: App do aluno por plano

**Files:**
- Modify: `gestao_web/src/lib/agendaAluno.js`, `gestao_web/src/lib/agendaAluno.test.js`, `gestao_web/src/components/aluno/AbaAgendarAulas.jsx`, `gestao_web/src/pages/AreaAluno.jsx`

**Interfaces:**
- Consumes: `dados.planos` de `listar_aulas_aluno`. Cada item tem `plano_aluno_id, nome, data_inicio, data_fim, bloqueia_a_partir_de, pausado_desde, encerrado_em, principal, regras`. Cada aula tem `plano_aluno_id`, e cada `consumo` tem `plano_aluno_id, plano_nome`.
- Produces:
  - `avisosDosPlanos(planos, hoje) → { tom, texto, planoAlunoId }[]`:
    - um aviso por plano, pela regra de `avisoDoPlano`;
    - com mais de um plano, o texto troca "Seu plano" por "Seu plano <nome>";
    - plano com `encerrado_em`: "Seu plano termina em DD/MM." (tom `aviso`) até `encerrado_em`, e "Seu plano terminou em DD/MM." (tom `bloqueio`) a partir de `bloqueia_a_partir_de`, com o nome quando há vários;
    - `avisoDoPlano` continua exportado, para um plano.
  - `aulasParaMostrar(aulas, planos, data)`: esconde a aula sem registro ativo cujo `plano_aluno_id` é de um plano pausado. Com um plano pausado só, o resultado é igual ao de hoje.
  - `consumoDaSemana`: sem mudança. O cartão usa `key` `${plano_aluno_id}-${area}`, mostra "<área> · <plano_nome>" quando há vários planos e esconde o consumo de plano pausado.
  - `AbaAgendarAulas`:
    - "Sem plano ativo" quando `planos` está vazio;
    - os avisos vêm de `avisosDosPlanos`, um bloco por aviso;
    - "Falar com a recepção" leva o nome do plano no texto quando há vários.
  - `AreaAluno` (perfil):
    - o cartão "Plano Ativo" vira um cartão por plano válido (`planos_aluno` do próprio aluno, que o RLS permite ler), com nome, "Vence em DD/MM/AA" e "Pausado desde…" quando for o caso;
    - o valor (`planos.preco`) só aparece com um plano, como hoje;
    - o cabeçalho (`user-card-plan`) mostra o principal, com `+N` quando há vários.

- [ ] **Step 1: Testes** em `agendaAluno.test.js`:
  - **A1:** `avisosDosPlanos([um plano vencido há 2 dias])` → texto idêntico ao de `avisoDoPlano` de hoje;
  - **A2:** dois planos, só o B vencido → um aviso "Seu plano <B> venceu em…";
  - **A3:** B pausado → as aulas de B somem do dia, e as de A ficam; a aula de B já agendada continua;
  - **A4:** B com `encerrado_em` = hoje+2 → "Seu plano <B> termina em …".
- [ ] **Step 2:** `npx vitest run src/lib/agendaAluno.test.js`. Esperado: os novos FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx vitest run` e `npm run build`. Esperado: verde.
- [ ] **Step 5:** Commit `feat(web): app do aluno mostra cada plano (ILU-127 4)`.

### Task 12: Grade e frequência por plano (notas da 3b)

**Files:**
- Modify: `gestao_web/src/lib/pausaPlano.js`, `gestao_web/src/lib/pausaPlano.test.js`, `gestao_web/src/pages/PerfilAluno.jsx` (`ResumoFrequenciaAluno`)

**Interfaces:**
- `anexarPausas(matriculas, periodos)` e `removerFixosEmPausa(fixos, periodos, data)` passam a considerar um período só quando `!p.aula_ids || p.aula_ids.includes(<aula_id da matrícula/fixo>)`. Com um plano, `aula_ids` traz todos os fixos do aluno, então nada muda.
- `ResumoFrequenciaAluno({ alunoId, planos })`: com mais de um plano válido, um `select` de plano, que começa no principal e chama `buscarResumoFrequencia(alunoId, planoAlunoId)`. Com um, como hoje.
- Ficam para a segunda leva (spec 6.4): `Presenca.jsx` (`fixosForaDePausa` lê a cópia do principal), `listarFaltasPendentesReposicao` (principal) e o nome do plano na linha "Mês não pago" das comissões. Esse último precisa de `plano_aluno_id` no retorno de `_apurar_repasses`.

- [ ] **Step 1: Testes:** a pausa de B com `aula_ids = [aula Z]` não tira o fixo de X de `removerFixosEmPausa`, e `anexarPausas` só anexa à matrícula de Z; sem `aula_ids`, como hoje.
- [ ] **Step 2:** Rodar (FAIL), implementar, rodar (PASS) e `npm run build`.
- [ ] **Step 3:** Commit `feat(web): grade e frequência respeitam o plano da pausa (ILU-127 4)`.

### Task 13: Verificação completa no staging

- [ ] **Step 1:** Em `gestao_web`: `npm run lint`, `npx vitest run` e `npm run build`. Esperado: tudo verde. Registrar a contagem de testes.
- [ ] **Step 2:** Aplicar as migrations das Tasks 2 e 3 no staging: `supabase link --project-ref mytmreoqysbxisszludl`, `supabase db push --linked`, e voltar com `supabase link --project-ref spmvrzftyqxalprpceqn`. Rodar de novo `ilu127_4_rpcs`, `ilu134_contagem_dancas` e os invariantes. Esperado: PASSOU.
- [ ] **Step 3:** Semear no staging, com tag `[TESTE 4]`:
  - modalidades X e Y (Dança) e Z (Funcional), com professor E2E e uma aula de cada na `agenda`;
  - os planos "2x Dança Mensal [TESTE 4]" (regra Dança 2) e "2x Treino Mensal [TESTE 4]" (regra Funcional 2), recorrentes.
- [ ] **Step 4:** Subir o app local contra o staging: `npx vite --port 5191 --strictPort` em segundo plano no `gestao_web` do worktree, e `preview_start {url}`. Confirmar o host do Supabase em `/src/lib/supabase.js`. O usuário entra com o admin de teste (`gestao_web/.env.test.local`); a senha não passa por este chat.
- [ ] **Step 5:** Percorrer com o aluno `e2e-aluno@iluminus.test`, sem plano no início:
  1. Planos → "+ Adicionar outro plano", com Dança. Conferir o cartão, a cobrança no Financeiro e o cadastro.
  2. "+ Adicionar outro plano" de novo, com Treino. Conferir dois cartões e o nome de cada plano na lista de alunos.
  3. Modalidades: X×2 → Dança e Z×1 → Treino. Salvar. Conferir que Y×3 recusa com o limite e que uma modalidade sem plano recusa.
  4. Renovar o Treino. Conferir que o ciclo de Dança e a cobrança dele não mudam.
  5. Pausar a Dança. Conferir que as cobranças listadas são só da Dança, que o cartão mostra "Pausado desde" e que Renovar fica desabilitado. Retomar.
  6. Financeiro: "Pagamento manual" regular. Conferir o seletor de plano obrigatório e a coluna com o rótulo do plano.
  7. Encerrar o Treino. Conferir "Encerra em…" e Desfazer; encerrar de novo.
  8. App do aluno (`e2e-aluno`, senha também em `.env.test.local`, digitada pelo usuário): agendar X e Z; ver os avisos e o consumo por plano. Mudar no banco o fim do Treino para hoje−6 e conferir que só Z bloqueia, com o nome do plano.
  9. Dashboard e Notificações: o plano vencendo/vencido aparece com o nome. Depois, `encerrado_em` = ontem e `efetivar_encerramentos()` no banco: o Treino some da lista, do Dashboard e dos avisos, e Z sai das modalidades.
  10. Cadastrar um aluno novo com plano e modalidades pelo NovoAluno, e converter um lead de teste. Conferir um plano do aluno em cada, com ciclo, cobrança e modalidades ligados a ele, e `alunos.modalidades_selecionadas` igual.
  11. Editar o cadastro do aluno de dois planos (nome e telefone). Conferir que salva e que os planos não mudam.
- [ ] **Step 6:** Screenshots dos passos 1, 3, 6 e 8 para o PR. Parar o vite (pelo PID da porta) e apagar os dados `[TESTE 4]`. Rodar os invariantes no staging. Esperado: PASSOU. Confirmar que `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`.

### Task 14: Revisão, produção, PR e fim da sincronização inversa

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review) com a Review Focus.
- [ ] **Step 2:** PR em **rascunho**. O corpo cobre:
  - o que muda para quem tem um plano: nada no app, e os mesmos avisos;
  - o que muda para o aluno 102 e os próximos de vários planos;
  - a tabela de escritores;
  - as RPCs novas e a ILU-134 (com os achados 2 e 3);
  - o que fica para a segunda leva;
  - a migration posterior ao deploy;
  - os testes e as screenshots.
  - Links completos do GitHub e do Linear.
- [ ] **Step 3:** **Pedir o OK do usuário** e aplicar as migrations das Tasks 2 e 3 em produção (`supabase migration list --linked`, `supabase db push --linked`). Rodar `ilu127_planos_aluno_invariantes.sql` (só leitura). Esperado: PASSOU.
- [ ] **Step 4:** Tirar o PR do rascunho. O usuário faz o merge, que publica o frontend.
- [ ] **Step 5:** Depois do deploy (`vercel whoami` = `iluminussaas-3261`; deploy de produção `READY`), segundo PR, a partir do `main` atualizado:
  - `supabase/migrations/<ts>_ilu127_fim_sinc_inversa.sql` + down + `scripts/sql-tests/ilu127_4_fim_sinc_inversa.sql`;
  - a migration faz `DROP TRIGGER trg_alunos_1_sinc_plano` e `DROP TRIGGER trg_alunos_2_sinc_modalidades`;
  - e cria `trg_alunos_0_guarda_copia` (`BEFORE INSERT OR UPDATE` em `alunos`). A guarda recusa com "Planos e modalidades do aluno são editados no perfil, aba Planos ou Modalidades." quando:
    - o aluno tem `planos_aluno` e um dos cinco campos muda;
    - ou é um INSERT com `plano_id` ou `modalidades_selecionadas` não vazios.
  - A guarda não recusa quando `current_setting('iluminus.copia_cadastro', true) = 'on'`. `_copiar_plano_para_cadastro` passa a fazer `set_config('iluminus.copia_cadastro', 'on', true)` antes do `UPDATE` e `'off'` depois.
  - A down recria os dois gatilhos da 3a e remove a guarda.
  - Casos do teste:
    - G1: escrita direta → recusa;
    - G2: renovar, pausar, `salvar_modalidades_aluno` e `efetivar_encerramentos()` continuam atualizando a cópia;
    - G3: aluno sem plano: `UPDATE` de nome passa;
    - G4: INSERT de aluno sem campos de plano passa.
  - Staging antes e depois, com a down e com todos os testes SQL. **OK do usuário**, produção, invariantes, PR (o merge não muda o frontend).
- [ ] **Step 6:** Limpeza pós-merge dos dois PRs: worktree, branch local e remota, Linear (sub-issue e ILU-134 concluídas; ILU-127 com a entrega 4 marcada ✅ e as pendências da segunda leva). Confirmar `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`.
