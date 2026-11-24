# Planos do aluno: segunda leva de telas (entrega 6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nenhuma tela lê mais os campos copiados de `alunos` (`plano_id` e o join `planos(...)` por ele, `data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde`, `modalidades_selecionadas`). Tudo passa a ler `planos_aluno` e `alunos_modalidades`, e a linha "Mês não pago" das comissões mostra o plano. Para aluno com um plano só, nada muda.

**Architecture:**
- A lib pura `lib/planosAluno.js` ganha as regras novas (plano da modalidade, pausa na aula, meta semanal, faltas por plano, agrupamento de vínculos), com Vitest.
- Os serviços e as telas trocam os selects. Onde dá, a forma dos objetos que as telas já consomem é mantida, para o diff ficar pequeno.
- Duas migrations:
  - **A:** o professor passa a ler `planos_aluno` e `alunos_modalidades` dos mesmos alunos que já lê em `alunos`. É paridade: hoje ele lê `alunos.*`, incluindo as cópias.
  - **B:** `_apurar_repasses` e `apurar_repasses` devolvem `plano_aluno_id` em cada linha.
- A remoção dos campos copiados fica numa **fase 2**, com plano e PR próprios (ver o fim deste documento).

**Tech Stack:** React 18 + Vite, TanStack Query, Supabase JS, Vitest; PostgreSQL (plpgsql) e Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-varios-planos-por-aluno-design.md` (6.4 "Entrega posterior", 7 item 6, 8, 9). Também o plano da entrega 4 (`2026-11-23-planos-aluno-telas.md`), as descrições de https://github.com/devpedroschuster/Iluminus_SaaS/pull/66 e https://github.com/devpedroschuster/Iluminus_SaaS/pull/67, e as notas da ILU-127.

## Global Constraints

- **Aluno com um plano só não vê diferença em nenhuma tela.** Cada regra nova, aplicada a um plano, tem que dar exatamente o resultado que a cópia dava. Os testes "um plano" (sufixo `1P`) provam isso.
- **Plano principal** = `planosValidos(planos, hoje)[0]`, a mesma regra de `_plano_aluno_principal`: não encerrado ou `encerrado_em >= hoje`, na ordem `(created_at, id)`. Hoje vem de `hojeBrasilia()`.
- **Plano de uma modalidade** = espelho de `_plano_da_aula`: o plano ligado em `alunos_modalidades` (entre todos os planos do aluno, válidos ou não); sem ligação, o principal; sem principal, `null`.
- **Nome do plano** só aparece quando o aluno tem mais de um plano. Nas telas de situação atual (Presença, ProfessorAlunos, Aniversariantes), "mais de um" conta só os válidos. Nas comissões, que olham meses passados, conta qualquer plano, válido ou não, como já faz o Financeiro do aluno.
- **Visibilidade do professor:** a mesma de hoje. Ele vê os alunos que já vê em `alunos` (`professor_select_alunos_das_proprias_comissoes`), e nenhum aluno a mais.
- **Ninguém no frontend grava** os campos copiados (já vale desde a entrega 4). Depois desta entrega, **ninguém lê**, exceto o que a lista "Leituras que ficam" permite.
- **Banco:**
  - toda migration tem down em `supabase/migrations-down/` e teste em `scripts/sql-tests/` no formato da ILU-127 (`DO $test$`, sub-blocos `TR001`, `RESULTADO <NOME>: PASSOU (n/n)`, dados `[TESTE 6]`, e-mails `teste-6-*@iluminus.test`). O teste de permissão usa a mesma simulação de login de `ilu127_4_rpcs.sql` (caso M7);
  - rodar no staging com `supabase db query --linked --project-ref mytmreoqysbxisszludl --output-format text -f <arquivo>`, concatenando antes as migrations ainda não aplicadas;
  - produção (`spmvrzftyqxalprpceqn`) **só com o OK explícito do usuário**, antes do merge (o merge publica o frontend).
- Rodar `vercel whoami` antes de qualquer comando Vercel (esperado `iluminussaas-3261`). Voltar o link do CLI para produção ao terminar no staging.

## Leituras dos campos copiados (grep de 2026-11-24)

Edge Functions: **nenhuma** lê os campos copiados. `gerar-repasses` lê `mensalidades.plano_id`, que não é cópia. As outras só leem `alunos.role`/`id`/`auth_id`.

Frontend (`gestao_web/src`):

| # | Onde | Lê | Destino (Task) |
|---|---|---|---|
| 1 | `pages/Presenca.jsx`, lista de alunos | `plano_id`, `plano_pausado_desde`, `planos(frequencia_semanal, is_plano_livre)` | `planos_aluno` + `alunos_modalidades` (6) |
| 2 | `pages/Presenca.jsx`, fixos da aula (2×), + `lib/pausaPlano.fixosForaDePausa` | `agenda_fixa.alunos(plano_pausado_desde)` | pausa do plano da modalidade da aula (4, 6) |
| 3 | `lib/utils.calcularFrequenciaMedia` (métrica da Presença) e o modal "Frequência" | `aluno.planos` | `metaSemanal`/`textoFrequencia` (4, 6) |
| 4 | `services/alunosService.listarFaltasPendentesReposicao` (Agenda, `ModalListaPresenca`) | período do principal (`fn_resumo_frequencia_aluno` sem plano) | período do plano de cada falta (4, 5) |
| 5 | `services/gradeService.listarMatriculasFixas` + `utils/calendarioParser.buildFixosIndex` | `alunos(data_inicio_plano, data_fim_plano)` | período do plano da modalidade da aula (4, 5) |
| 6 | `pages/Professor/ProfessorAlunos.jsx` | `modalidades_selecionadas` (filtro e exibição), `planos(nome)` | `alunos_modalidades` (7) |
| 7 | `services/modalidadeService.buscarPerfil` (página Modalidades) | `.contains('modalidades_selecionadas')`, `planos(nome)` | `alunos_modalidades` (5) |
| 8 | `services/alunosService.listarAniversariantes` (Aniversariantes) | `planos(nome)` | principal de `planos_aluno` (5) |
| 9 | `services/alunosService.buscarPerfilCompleto` | `planos(nome, regras_acesso)`, sem uso | sai o embed (5) |
| 10 | `services/dashboardService.obterDistribuicaoPorArea` + `lib/utils.contarAlunosPorArea` | `modalidades_selecionadas` | `alunos_modalidades` (4, 5) |
| 11 | `services/financeiroService.listarModalidadesDoAluno` (pagamento manual) | `modalidades_selecionadas` | `alunos_modalidades` (5) |
| 12 | `pages/PerfilAluno.jsx`, `AbaAgendaFixa` | `aluno.modalidades_selecionadas` (limite e filtro das turmas) | `['aluno-modalidades', id]` (8) |
| 13 | `pages/NovoAluno.jsx`, edição | `setModalidadesSelecionadas(aluno.modalidades_selecionadas)`, estado sem uso na edição | sai (8) |
| 14 | `pages/AreaAluno.jsx` | `planos(nome, preco, regras_acesso)`, `plano_pausado_desde` (fallback sem `planos_aluno`) | só `planos_aluno` (8) |
| 15 | `components/ModalAdicionarPagamentoManual.jsx` | `alunos.plano_id` como plano padrão (3×) | plano escolhido de `planos_aluno` (8) |
| 16 | `pages/Comissoes.jsx`, "Mês não pago" | sem o plano | `plano_aluno_id` da apuração (3, 9) |

**Leituras que ficam** (não são cópia):
- o campo de formulário `plano_id` do NovoAluno e de `lib/validation.js` (`alunoSchema`). É o plano escolhido no cadastro e vai para `criarPrimeiroPlano`. O spec cita `validation`; conferido, não há nada a mudar;
- `data_fim_plano` como chave de retorno de RPC (`ModalPausaPlano`) e de `dashboardService.obterAlunosPlanosVencendo`, que já vem de `planos_aluno`;
- `plano_id` de `mensalidades`, `historico_planos`, `planos_aluno` e do formulário de renovação;
- `alunosService.listar` com `select('*')`, porque nenhuma tela usa as cópias que vêm nele.

**Produção (leitura de 2026-11-24):**
- 80 alunos ativos, 1 com mais de um plano válido (o 102);
- nenhum aluno com modalidades no array e sem plano do aluno;
- só os alunos **inativos** 16 e 71 têm o array com modalidades e `alunos_modalidades` vazio. As telas trocadas filtram ativos, então nada muda para eles; fica registrado para a fase 2.

## Review Focus

1. **Aluno de um plano em cada tela trocada:** mesma lista, mesmo selo "Plano pausado", mesma meta de frequência, mesmas faltas para repor, mesmos fixos na grade, mesmo "Mês não pago" sem nome. Testes `1P` nas Tasks 4 e 5 e passo 8 da Task 10.
2. **Professor:** continua vendo os mesmos alunos, não passa a ver aluno sem comissão com ele e não escreve nas tabelas novas. Teste SQL P1–P4 (Task 2) e os passos do professor no staging (Task 10).
3. **Pausa de um plano na chamada:** pausar a Dança não tira o aluno da turma de Treino como fixo, nem põe o selo nela. Testes PZ1P–PZ3 (Task 4).
4. **Falta de um plano repondo noutro:** a falta da Dança aparece com o período da Dança, e a do Treino com o do Treino. Falta de modalidade sem ligação usa o principal. Testes FP1P–FP3 (Task 4) e FL1P/FL2 (Task 5).
5. **Apuração com a coluna nova:** nenhum valor, situação ou gravação muda. `apurar_repasses_da_cobranca` e `prever_repasses` mantêm a assinatura, e o `gerar-repasses` continua funcionando. Todos os testes SQL de repasse iguais à base (Task 3).

---

### Task 1: Worktree, staging e plano

- [ ] **Step 1:** Confirmar que o worktree `claude/ilu-telas-segunda-leva-af4c0f` está em `origin/main` (`0e4a8cd` em 2026-11-24); se não, rebasear. Copiar `gestao_web/.env.local` e `gestao_web/.env.test.local` da pasta principal (não são commitados).
- [ ] **Step 2:** `supabase migration list --linked --project-ref mytmreoqysbxisszludl`: o staging tem que ter até `20261124120000`. Se faltar, parar e avisar.
- [ ] **Step 3:** O registro no Linear já foi feito, na seção "Entrega 6" da ILU-127. O workspace continua no limite de issues, então não há sub-issue.
- [ ] **Step 4:** Commit do plano: `docs: plano da entrega 6 de ILU-127 (segunda leva de telas)`.

### Task 2: Professor lê os planos dos alunos que já vê (migration A)

**Files:**
- Create: `supabase/migrations/20261124130000_ilu127_6_professor_le_planos.sql` + down (`DROP POLICY` das duas)
- Create: `scripts/sql-tests/ilu127_6_professor_leitura.sql`

**Interfaces:**
- Produces: duas políticas `FOR SELECT TO authenticated`, `planos_aluno_select_professor` e `alunos_modalidades_select_professor`. O `USING` é o mesmo de `alunos.professor_select_alunos_das_proprias_comissoes`, trocando `alunos.id` por `<tabela>.aluno_id`:
  `EXISTS (SELECT 1 FROM public.repasses_lancamentos r JOIN public.professores p ON p.id = r.professor_id WHERE r.aluno_id = <tabela>.aluno_id AND p.auth_id = (SELECT auth.uid()))`.
  Os grants não mudam: o `authenticated` já tem `SELECT`.

- [ ] **Step 1: Escrever o teste.** Montar o professor X com uma comissão do aluno A; o aluno B não tem comissão com X.

  | Caso | Como | Espera |
  |---|---|---|
  | P1 | como X | lê os `planos_aluno` e `alunos_modalidades` de A |
  | P2 | como X | 0 linhas de B |
  | P3 | como X | `INSERT`/`UPDATE` em `alunos_modalidades` de A falha |
  | P4 | como o aluno A | lê só os próprios, igual a antes |

- [ ] **Step 2:** Staging sem a migration. Esperado: FALHOU em P1, e PASSOU em P2–P4.
- [ ] **Step 3:** Escrever a migration e a down.
- [ ] **Step 4:** Staging com a migration: o teste novo PASSOU, e todos os outros `scripts/sql-tests/*.sql` com o mesmo resultado da base (rodar a base antes). Depois a down, mais `ilu127_planos_aluno_invariantes`. Esperado: PASSOU.
- [ ] **Step 5:** Commit `feat(db): professor lê os planos dos alunos que já vê (ILU-127 6)`.

### Task 3: Plano em cada linha da apuração (migration B)

**Files:**
- Create: `supabase/migrations/20261124131000_ilu127_6_plano_na_apuracao.sql` + down
- Create: `scripts/sql-tests/ilu127_6_plano_na_apuracao.sql`

**Interfaces:**
- Produces:
  - `public._apurar_repasses(date, bigint, boolean, boolean)`: mesmos argumentos e ACL, e o `RETURNS TABLE` ganha uma última coluna, `plano_aluno_id uuid`. Como o tipo de retorno muda, é `DROP FUNCTION` + `CREATE`. O corpo é o de `20261123121000_ilu134_contagem_dancas.sql`, mudando só isto:
    - cada ramo de `linhas` carrega o plano que já tem à mão:
      - regular: `rg.plano_aluno_id`;
      - livre: `lv.plano_aluno_id`;
      - `livre_planos`: `la.plano_aluno_id`;
      - pausado e sem cobertura: `e.plano_aluno_id`;
      - `avaliadas`: `av.plano_aluno_id`;
      - bolsista e inativo: `NULL`;
    - o `SELECT` final devolve `fi.plano_aluno_id`.
    - Valores, situações, `ON CONFLICT` e ordenação não mudam.
  - `public.apurar_repasses(date, bigint, boolean)`: `DROP` + `CREATE` com a mesma coluna a mais. Corpo e ACL iguais aos de `20261116121000_apurar_repasses.sql`.
  - `public.apurar_repasses_da_cobranca(bigint)`: `CREATE OR REPLACE` com a **mesma assinatura**. O `RETURN QUERY SELECT *` vira a lista explícita das 11 colunas antigas, para que a Edge Function `gerar-repasses` não mude. O corpo é o de `20261116122000_repasses_portas_e_vinculos.sql`.
  - `prever_repasses` (colunas explícitas) e `apurar_repasses_agendado` (`PERFORM`) não mudam.
  - Down: volta `_apurar_repasses` à versão de `20261123121000` e `apurar_repasses` à de `20261116121000` (`DROP` + `CREATE`), e `apurar_repasses_da_cobranca` à de `20261116122000`, com as ACLs.

- [ ] **Step 1: Escrever o teste** (competência dezembro de 2026):

  | Caso | Faz | Espera |
  |---|---|---|
  | AP1 | aluno com planos regulares A (Dança 1) e B (Dança 2); paga só A; `apurar_repasses(dez, aluno, true)` | linha `sem_cobertura` com `modalidade_id` nulo e `plano_aluno_id = B`; linha de Dança 1 com `plano_aluno_id = A` |
  | AP2 | um plano só, sem pagamento | uma linha `sem_cobertura` com o `plano_aluno_id` dele |
  | AP3 | aluno bolsista | linha `bolsista` com `plano_aluno_id` nulo |
  | AP4 | `apurar_repasses_da_cobranca(<cobrança paga de A>)` | devolve as 11 colunas de antes (conferir `pg_get_function_result`) e grava como antes |
  | AP5 | `prever_repasses(<mês seguinte>)` | roda sem erro, com as mesmas colunas |

- [ ] **Step 2:** Staging sem a migration. Esperado: FALHOU em AP1–AP3 (coluna inexistente), e PASSOU em AP4/AP5.
- [ ] **Step 3:** Escrever a migration e a down. Mostrar o `diff` do corpo de `_apurar_repasses` contra a versão de `20261123121000`: só as linhas do plano.
- [ ] **Step 4:** Staging com as migrations A e B: o teste novo PASSOU, e **todos** os outros iguais à base, em especial `comissao_valor_dancas`, `repasses_competencia`, `ilu125_a_vista_no_recebimento`, os `ilu127_3c_*` e `ilu134_contagem_dancas`. Depois as downs em ordem inversa, mais `repasses_competencia`. Esperado: PASSOU.
- [ ] **Step 5:** Commit `feat(db): apuração devolve o plano do aluno de cada linha (ILU-127 6)`.

### Task 4: Regras novas na lib pura

**Files:**
- Modify: `gestao_web/src/lib/planosAluno.js`, `gestao_web/src/lib/planosAluno.test.js`, `gestao_web/src/lib/pausaPlano.js`, `gestao_web/src/lib/pausaPlano.test.js`, `gestao_web/src/lib/utils.js`, `gestao_web/src/lib/utils.test.js`, `gestao_web/src/lib/repasses.js`, `gestao_web/src/lib/repasses.test.js`

**Interfaces:**
- Consumes: `planosValidos`, `rotuloPlanoAluno` (entrega 4). Um vínculo é `{ modalidade_id, plano_aluno_id, vezes? }`. Os planos têm a forma da entrega 4, com `planos: { nome, frequencia_semanal?, is_plano_livre? }`.
- Produces (todas puras; `hoje` sempre parâmetro):
  - `planoDaModalidade(modalidadeId, vinculos, planos, hoje) → plano|null` (Global Constraints).
  - `pausadoNaAula(modalidadeId, vinculos, planos, hoje) → boolean` (mesma ordem de `planoDaModalidade`): `!!planoDaModalidade(...)?.pausado_desde`. Com `modalidadeId` nulo, usa o principal.
  - `periodoDoPlano(plano) → { inicio, fim }`: `data_inicio`/`data_fim`, ou `{ inicio: null, fim: null }` sem plano.
  - `metaSemanal(planos, hoje) → number|null`:
    - sem plano válido → `1`, como hoje ("sem plano, a meta é 1");
    - todos os válidos livres (`ehPlanoLivre(p.planos)`) → `null`, que fica fora da média;
    - senão, a soma de `frequencia_semanal` dos válidos não livres.
  - `textoFrequencia(planos, hoje) → string`:
    - um plano válido: o texto de hoje (`'Livre'` ou `formatarFrequenciaSemanal(...) || '—'`);
    - nenhum: `'—'`;
    - vários: o texto de cada plano, unidos por `' + '`.
  - `faltasPendentesPorPlano(faltas, periodos, vinculos, principalId) → falta[]`:
    - `faltas`: `{ id, data_aula, agenda: { modalidade_id } }`;
    - `periodos`: `Map<planoAlunoId, { inicio, fim }>`;
    - fica a falta cuja data está no período do plano da modalidade dela (pelo vínculo; sem vínculo, `principalId`);
    - plano sem período → a falta sai.
  - `agruparVinculosPorAluno(linhas) → [{ ...aluno, modalidades: string[], planosNomes: string[] }]`:
    - `linhas`: `alunos_modalidades` com `alunos` e `planos_aluno(planos(nome))` embutidos;
    - `modalidades` repete cada id `vezes` vezes, em ordem de `modalidade_id`, como o array copiado;
    - `planosNomes`: os nomes distintos dos planos ligados;
    - ordem: `nome_completo` (`localeCompare` pt-BR).
  - `pausaPlano.fixosForaDePausa(fixos, alunosPorId, modalidadeId, hoje) → Set<alunoId>`: substitui a versão de hoje. Fica fora quem está em `pausadoNaAula`. Aluno ausente de `alunosPorId` fica dentro.
  - `utils.calcularFrequenciaMedia(alunos, presencasPorAluno, hoje)`: a meta de cada aluno vem de `metaSemanal(aluno.planos_aluno, hoje)`. Com `null`, o aluno fica fora; o resto da conta é igual.
  - `utils.contarAlunosPorArea(alunos, areaById)`: os ids vêm de `(aluno.alunos_modalidades || []).map(m => m.modalidade_id)`.
  - `repasses.alunosSemComissao(linhas, nomePlano = () => null)`: numa linha `sem_cobertura` ou `pausado` com `nomePlano(l)` não nulo, o motivo vira `"<rótulo> (<nome>)"`, por exemplo "Mês não pago (2x Treino Mensal)". Sem nome, fica igual a hoje.

- [ ] **Step 1: Escrever os testes** (hoje = `'2026-11-24'`):
  - **PM1P:** um plano A, sem vínculo para a modalidade → `planoDaModalidade` = A. **PM2:** dois planos, vínculo X→B → B; sem vínculo → o principal; vínculo para um plano já encerrado, fora de `planosValidos` → esse mesmo plano (espelho do banco).
  - **PZ1P:** um plano pausado → `fixosForaDePausa` tira o aluno em qualquer modalidade, igual a hoje. **PZ2:** B pausado, aula de X (ligado a A) → o aluno fica, e `pausadoNaAula` = false. **PZ3:** aula de Z (ligado a B) → o aluno sai, e o selo aparece.
  - **MS1P:** plano 2x → meta 2; plano livre → `null`; sem plano → 1. **MS2:** 2x + livre → 2; 2x + 3x → 5. `calcularFrequenciaMedia`: os testes atuais, reescritos com `planos_aluno` de um plano, dão os mesmos números.
  - **TF1P:** `textoFrequencia` de um plano 2x = `formatarFrequenciaSemanal(2)`. **TF2:** 2x + livre → `'2x por semana + Livre'`.
  - **FP1P:** um plano com período 01/11–30/11 → as faltas dentro ficam e as de fora saem, com ou sem vínculo (igual a hoje). **FP2:** A (Dança, 01/10–31/10) e B (Treino, 01/11–30/11): uma falta de Dança em 05/11 sai, e uma de Treino em 05/11 fica. **FP3:** falta de modalidade sem vínculo → período do principal.
  - **AG1P:** `agruparVinculosPorAluno` com X×2 de um aluno → `modalidades = [X, X]` e `planosNomes = [nome]`. **AG2:** dois planos → dois nomes, sem repetir.
  - **CA1P:** `contarAlunosPorArea` com os casos atuais em `alunos_modalidades` dá os mesmos números.
  - **R1:** `alunosSemComissao` com `nomePlano` devolvendo "2x Treino" na linha `sem_cobertura` → "Mês não pago (2x Treino)". **R1P:** sem `nomePlano` → "Mês não pago".
- [ ] **Step 2:** `npx vitest run src/lib` (em `gestao_web`). Esperado: os novos FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS, todos.
- [ ] **Step 5:** Commit `feat(web): regras por plano para presença, grade, faltas e comissões (ILU-127 6)`.

### Task 5: Serviços leem as tabelas novas

**Files:**
- Modify: `gestao_web/src/services/gradeService.js`, `gestao_web/src/utils/calendarioParser.js`, `gestao_web/src/services/modalidadeService.js`, `gestao_web/src/services/alunosService.js`, `gestao_web/src/services/dashboardService.js`, `gestao_web/src/services/financeiroService.js`
- Test: `gestao_web/src/services/gradeService.test.js`, `gestao_web/src/utils/calendarioParser.test.js`, `gestao_web/src/services/alunosService.test.js`, `gestao_web/src/services/dashboardService.test.js`, `gestao_web/src/services/financeiroService.test.js`
- Create: `gestao_web/src/services/modalidadeService.test.js` (mesmo mock de `gradeService.test.js`)

**Interfaces:**
- Consumes: Task 4; `listarPlanosDoAluno` e `listarModalidadesLigadas` (entrega 4).
- Produces:
  - `gradeService.listarMatriculasFixas(aulasIds)`:
    - select `aula_id, agenda(modalidade_id), alunos(id, nome_completo, planos_aluno(id, data_inicio, data_fim, encerrado_em, created_at), alunos_modalidades(modalidade_id, plano_aluno_id))`;
    - cada `alunos` ganha `periodo = periodoDoPlano(planoDaModalidade(agenda.modalidade_id, …, hojeBrasilia()))`;
    - depois, `anexarPausas`, como hoje.
  - `calendarioParser.buildFixosIndex`: `inicio`/`fim` vêm de `m.alunos.periodo`.
  - `modalidadeService.buscarPerfil(id)`, a parte dos alunos:
    - lê `alunos_modalidades` com `.eq('modalidade_id', id)`, `alunos!inner(id, nome_completo, ativo)` e `planos_aluno(planos(nome))`, mais `.eq('alunos.ativo', true)`;
    - devolve `alunos: [{ id, nome_completo, planos: { nome } | null }]` em ordem de nome, a mesma forma que `Modalidades.jsx` já usa.
  - `alunosService.listarAniversariantes()`:
    - `planos(nome)` vira `planos_aluno(id, data_inicio, encerrado_em, encerramento_efetivado, created_at, planos(nome))`;
    - cada aluno ganha `planos = { nome: <nome do principal> + (validos > 1 ? ' +N' : '') }`, ou `null`. A tela não muda.
  - `alunosService.buscarPerfilCompleto`: `select('*')`, sem o embed.
  - `alunosService.listarFaltasPendentesReposicao(alunoId)`:
    - busca em paralelo `listarPlanosDoAluno` e `listarModalidadesLigadas`;
    - **zero ou um plano válido:** o fluxo de hoje, passando o id do plano quando há um;
    - **vários:**
      - `buscarResumoFrequencia(alunoId, id)` para cada plano válido;
      - faltas de `min(inicio)` a `max(fim)`, com `agenda(atividade, modalidade_id)`;
      - `faltasPendentesPorPlano`;
    - depois, os filtros atuais de pausa e reposição.
  - `dashboardService.obterDistribuicaoPorArea`: select `id, bolsista, alunos_modalidades(modalidade_id)`.
  - `financeiroService.listarModalidadesDoAluno(alunoId)`: os ids distintos de `alunos_modalidades` do aluno, depois os nomes, como hoje.
  - `alunosService.listarPlanosDeAlunos(alunoIds)` (para a Task 9): `planos_aluno` com `.in('aluno_id', ids)` e os campos de `listarPlanosDoAluno`. Lista vazia → `[]`, sem consulta.

- [ ] **Step 1: Testes:**
  - grade: **G1P**, um fixo com um plano → `periodo` = datas do plano; **G2**, dois planos → as datas do plano da modalidade;
  - calendarioParser: o fixture atual, passado para `periodo`, dá o mesmo resultado;
  - `modalidadeService.buscarPerfil`: consulta `alunos_modalidades` filtrando a modalidade e devolve a forma acima;
  - aniversariantes: **AN1P**, um plano → o nome; dois → "Nome +1";
  - faltas: **FL1P**, um plano → uma chamada de `fn_resumo_frequencia_aluno` com `p_plano_aluno_id` e o mesmo resultado de hoje; **FL2**, dois planos → duas chamadas e a filtragem por plano;
  - distribuição: o select leva `alunos_modalidades`;
  - `listarModalidadesDoAluno` lê `alunos_modalidades`;
  - `listarPlanosDeAlunos([])` não consulta.
- [ ] **Step 2:** `npx vitest run src/services src/utils`. Esperado: os novos FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS, todos.
- [ ] **Step 5:** Commit `feat(web): serviços leem planos_aluno e alunos_modalidades (ILU-127 6)`.

### Task 6: Presença por plano

**Files:**
- Modify: `gestao_web/src/pages/Presenca.jsx`

**Interfaces:**
- Consumes: `fixosForaDePausa`, `pausadoNaAula`, `textoFrequencia` e `calcularFrequenciaMedia(…, hoje)` (Task 4).
- Muda:
  - a lista de alunos: `select('id, nome_completo, email, planos_aluno(id, plano_id, data_inicio, data_fim, pausado_desde, encerrado_em, encerramento_efetivado, created_at, planos(nome, frequencia_semanal, is_plano_livre)), alunos_modalidades(modalidade_id, plano_aluno_id)')`;
  - `todasAulasQuery` passa a ler também `modalidade_id`;
  - os dois selects de `agenda_fixa` viram `select('aluno_id')`, e os fixos vêm de `fixosForaDePausa(fixos, alunosPorId, <modalidade_id da aula>, hojeBrasilia())`. `alunosPorId` é um `Map` da lista já carregada; no efeito da aula selecionada, ler do estado `alunos`;
  - `BotaoAluno` recebe `modalidadeId`, e o selo "Plano pausado" (mesmo texto) usa `pausadoNaAula`;
  - `calcularMetricas` passa `hojeBrasilia()`;
  - o modal "Frequência" usa `textoFrequencia(alunoSelecionado.planos_aluno, hoje)`.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run` em `gestao_web`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): chamada e métricas da Presença por plano do aluno (ILU-127 6)`.

### Task 7: ProfessorAlunos pelas modalidades ligadas

**Files:**
- Modify: `gestao_web/src/pages/Professor/ProfessorAlunos.jsx`

**Interfaces:**
- Consumes: `agruparVinculosPorAluno` (Task 4); a política da Task 2.
- A consulta de alunos vira:
  - `supabase.from('alunos_modalidades').select('modalidade_id, vezes, alunos!inner(id, nome_completo, email, telefone, ativo, role), planos_aluno(planos(nome))')`;
  - com os filtros `.in('modalidade_id', idsModalidades)`, `.eq('alunos.ativo', true)` e `.eq('alunos.role', 'aluno')`;
  - depois, `agruparVinculosPorAluno`.
- Só entram as modalidades do professor. O array de hoje trazia todas as do aluno, então a coluna "Modalidades" passa a mostrar só as dele. *Decisão do plano:* é a tela do professor, e os alunos listados continuam os mesmos.
- A tela troca `modalidades_selecionadas` por `modalidades` no filtro (linha 173) e na exibição (linhas 288 e 392). O `Badge` do plano vira um por item de `planosNomes`.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): alunos do professor pelas modalidades ligadas (ILU-127 6)`.

### Task 8: Perfil, cadastro, app do aluno e pagamento manual

**Files:**
- Modify: `gestao_web/src/pages/PerfilAluno.jsx` (`AbaAgendaFixa`), `gestao_web/src/pages/NovoAluno.jsx`, `gestao_web/src/pages/AreaAluno.jsx`, `gestao_web/src/components/ModalAdicionarPagamentoManual.jsx`

**Interfaces:**
- `AbaAgendaFixa`:
  - usa `useQuery(['aluno-modalidades', alunoId], () => alunosService.listarModalidadesLigadas(alunoId))`, a mesma chave da aba Modalidades;
  - `getCountModEspecifica(modId)` = `vezes` do vínculo, e `modIdsDoAluno` = os ids ligados;
  - o resto não muda.
- `NovoAluno`: sai `setModalidadesSelecionadas(aluno.modalidades_selecionadas || [])` da carga da edição. O estado só é usado na criação; confirmar com grep antes de tirar.
- `AreaAluno`:
  - a consulta do perfil vira `select('*')`;
  - `planoPrincipal = meusPlanos[0]?.planos ?? null`;
  - o terceiro ramo do cartão (aluno sem `planos_aluno`) mostra "Nenhum" e "Você ainda não possui um plano vinculado.", sem ler `aluno.planos` nem `aluno.plano_pausado_desde`.
- `ModalAdicionarPagamentoManual`:
  - os dois selects de `alunos` deixam de ler `plano_id`, e as três atribuições de `defaultPlano` saem;
  - um efeito novo: quando `planoAlunoId` muda e não houve escolha manual (`!planoAlunoEscolhido`), `form.plano_id` = `plano_id` desse plano;
  - `valor_pago` recebe o preço **só se estiver vazio**. Assim, a cobrança em aberto, que chega depois (o efeito dela espera `aguardandoPlano`), continua definindo o valor, como hoje.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): perfil, app e pagamento manual sem os campos copiados (ILU-127 6)`.

### Task 9: Plano na linha "Mês não pago" das comissões

**Files:**
- Modify: `gestao_web/src/pages/Comissoes.jsx`

**Interfaces:**
- Consumes: `alunosSemComissao(linhas, nomePlano)` (Task 4); `listarPlanosDeAlunos` (Task 5); `plano_aluno_id` nas linhas (Task 3).
- Depois de carregar as linhas:
  - uma query `['planos-de-alunos', ids]`, com os `aluno_id` das linhas `sem_cobertura`/`pausado` que têm `plano_aluno_id`;
  - `nomePlano(l)` = `rotuloPlanoAluno(plano, planosDoAluno)` quando o aluno tem mais de um plano (válido ou não); senão, `null`.
  - Antes da migration B, ou com a query ainda carregando, `nomePlano` devolve `null`, e a tela fica como hoje.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run build` e `npx vitest run`. Esperado: verde.
- [ ] **Step 3:** Commit `feat(web): comissões mostram o plano não pago (ILU-127 6)`.

### Task 10: Grep final e verificação no staging

- [ ] **Step 1: Grep.** Em `gestao_web/src` (fora de `*.test.*`) e em `supabase/functions`:
  `rg -n "data_inicio_plano|data_fim_plano|plano_pausado_desde|modalidades_selecionadas" gestao_web/src supabase/functions -g '!*.test.*'`. Esperado: só os itens de "Leituras que ficam".
  Depois, `rg -n "from\('alunos'\)" -A3 gestao_web/src`: nenhum select de `alunos` com `planos(` nem `plano_id`, exceto o formulário do NovoAluno. Se aparecer algo novo, atualizar a tabela deste plano.
- [ ] **Step 2:** `npm run lint`, `npx vitest run` e `npm run build` em `gestao_web`. Esperado: tudo verde. Registrar a contagem de testes.
- [ ] **Step 3:** Aplicar as migrations A e B no staging:
  - `supabase link --project-ref mytmreoqysbxisszludl`;
  - `supabase db push --linked`;
  - voltar com `supabase link --project-ref spmvrzftyqxalprpceqn`.
  - Rodar de novo os dois testes novos e os invariantes. Esperado: PASSOU.
- [ ] **Step 4: Semear no staging** (tag `[TESTE 6]`):
  - modalidades X (Dança) e Z (Funcional), com o professor E2E e uma aula de cada na `agenda` hoje;
  - o aluno `e2e-aluno@iluminus.test` com os planos "2x Dança Mensal [TESTE 6]" (X ligado) e "2x Treino Mensal [TESTE 6]" (Z ligado), fixo nas duas aulas;
  - uma falta em cada modalidade;
  - uma comissão `[TESTE 6]` do professor E2E para esse aluno, para que ele apareça na tela do professor;
  - um segundo aluno de teste com um plano só, para a comparação "nada muda".
- [ ] **Step 5:** Subir o app local contra o staging: `npx vite --port 5191 --strictPort` em segundo plano no `gestao_web` do worktree, e `preview_start {url}`. Confirmar o host do Supabase. O usuário entra com as contas de `gestao_web/.env.test.local`; a senha não passa por este chat.
- [ ] **Step 6: Percorrer:**
  1. **Admin, Presença:** pausar a Dança. Na chamada da aula de Z, o aluno é fixo e não tem selo. Na aula de X, sai dos fixos e aparece com o selo "Plano pausado". O modal mostra "2x por semana + 2x por semana". Retomar.
  2. **Admin, Agenda:** os dois fixos aparecem nas datas do plano de cada um. Mudar no banco o fim do Treino para ontem: só o fixo de Z some depois dessa data.
  3. **Agenda, "Reposição?"** numa aula de Z: aparece só a falta do período do Treino.
  4. **Modalidades** (X e Z), **Aniversariantes**, **Dashboard** (distribuição por área) e **pagamento manual** (modalidades e plano padrão): o aluno aparece com o plano certo.
  5. **Professor E2E:** "Meus alunos" mostra o aluno com X/Z e o nome do plano; a Agenda do professor mostra os fixos.
  6. **Comissões**, no mês corrente simulado: com só a Dança paga, o aluno aparece com "Mês não pago (2x Treino Mensal [TESTE 6])".
  7. **App do aluno:** o perfil mostra os dois cartões, e nada quebra sem o embed `planos`.
  8. **Aluno de um plano:** os passos 1, 3 e 6 dão o mesmo resultado que davam antes (Presença, reposição, comissões sem nome).
- [ ] **Step 7:** Screenshots dos passos 1, 5 e 6 para o PR. Parar o vite (pelo PID da porta) e apagar os dados `[TESTE 6]`. Rodar os invariantes no staging. Esperado: PASSOU. Confirmar que `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`.

### Task 11: Revisão, produção, PR e limpeza

- [ ] **Step 1:** Revisão do branch inteiro (superpowers:requesting-code-review) com a Review Focus.
- [ ] **Step 2:** PR em **rascunho**. O corpo cobre:
  - o que muda para quem tem um plano: nada;
  - o que muda para o aluno 102 e os próximos alunos de vários planos;
  - a tabela de leituras;
  - as duas migrations;
  - a decisão do ProfessorAlunos (só as modalidades do professor);
  - a fase 2;
  - os testes e as screenshots;
  - links completos do GitHub e do Linear.
- [ ] **Step 3:** **Pedir o OK do usuário** e aplicar as migrations A e B em produção (`supabase migration list --linked`, `supabase db push --linked`). Rodar `ilu127_planos_aluno_invariantes.sql` (só leitura). Esperado: PASSOU.
- [ ] **Step 4:** Tirar o PR do rascunho. O usuário faz o merge, que publica o frontend. Depois do deploy, `vercel whoami` = `iluminussaas-3261` e o deploy de produção `READY`.
- [ ] **Step 5:** Limpeza pós-merge: worktree, branch local e remota, Linear (seção "Entrega 6" da ILU-127 marcada ✅, com o link do PR). Confirmar que `supabase/.temp/project-ref` = `spmvrzftyqxalprpceqn`.

---

## Fase 2 (proposta): remoção dos campos copiados

Não faz parte da execução deste plano. A proposta é **um plano e um PR próprios**, escritos depois do deploy desta leva. A migration de remoção só seria aplicada depois que o frontend publicado deixar de ler as cópias, porque um frontend antigo aberto numa aba quebraria ao perder as colunas.

O que ela teria que cobrir (levantamento de 2026-11-24 em `pg_proc` da produção):
- **Funções que ainda leem as cópias:**
  - `_apurar_repasses` (`modalidades_selecionadas`);
  - `_fixo_valido` (`data_inicio_plano`);
  - `fn_gerar_presencas_fixos` (as datas);
  - `listar_aulas_aluno` (as chaves antigas do app);
  - as chaves de retorno de `pausar_plano_aluno` e `retomar_plano_aluno`.
  - Cada uma tem que ser reescrita, ou é preciso confirmar que é só nome de chave.
- **O que sai:**
  - os gatilhos da cópia (`_trg_alunos_sinc_plano`, `_trg_alunos_sinc_modalidades`, a guarda do PR 67, `_copiar_plano_para_cadastro`, `_trg_historico_planos_plano_aluno`, `_trg_planos_aluno_liga_orfaos`);
  - os gatilhos `BEFORE INSERT` que preenchem `plano_aluno_id` nulo;
  - as colunas, inclusive a FK de `alunos.plano_id`.
- **Testes SQL:** cerca de 19 arquivos em `scripts/sql-tests/` montam alunos gravando direto nas cópias e precisam ser reescritos.
- **Dados:** os alunos inativos 16 e 71 têm modalidades só no array e as perderiam.
- **Segurança:** backup antes (`docs/DEPLOY.md`). A down recria as colunas e as preenche a partir de `planos_aluno`.
