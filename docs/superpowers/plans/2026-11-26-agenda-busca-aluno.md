# Busca de aluno na Agenda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na Agenda, o admin busca uma aluna pelo nome e abre um painel com as turmas fixas e as próximas aulas agendadas dela, podendo ir até a aula no calendário, trocar a turma fixa e desmarcar uma aula agendada sem sair da tela.

**Architecture:** Só frontend, sem migration. A lógica pura (filtro por nome, turmas da aluna, turmas para troca, próxima data de uma turma, dia da semana tolerante) fica em `src/lib/`, testada com vitest. Duas funções novas de serviço (listar próximas agendadas, trocar turma fixa) seguem o padrão dos serviços com `criarQueryMock`. A tela é um componente de busca + um painel lateral ligados à `Agenda.jsx`; o destaque no calendário entra pelo `eventPropGetter` do `CalendarioGrade`.

**Tech Stack:** React + Vite, @tanstack/react-query, react-big-calendar, date-fns, Supabase JS, vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-agenda-busca-aluno-e-fechamento-design.md` (Parte 1).

## Global Constraints

- Busca e painel só para `perfil === 'admin'`.
- Fonte da lista de alunas: a consulta que a Agenda já faz (`['alunos', 'ativos-agendamento']`, `alunosService.listarAtivos` → `{ id, nome_completo }`).
- "Desmarcar" chama `agendamentoService.cancelarAgendamento(presencaId)` (mesma ação do "Remover" da chamada; numa presença `agendado` grava `cancelado`, que fica como reposição pendente). Nenhuma regra nova.
- "Trocar horário" só oferece turmas **da mesma modalidade** da turma atual, recorrentes, não encerradas (`data_fim` nula ou maior que hoje) e em que a aluna ainda não está. Como a modalidade não muda, o limite de vezes da modalidade não muda.
- Turma lotada (fixas ≥ `capacidade`) pode ser escolhida, mas pede confirmação dizendo que está lotada — o perfil da aluna hoje nem avisa, então não bloquear.
- Presenças já geradas para a turma antiga não são mexidas na troca (mesmo comportamento do perfil hoje).
- `CalendarioGrade` é `React.memo` (ILU-47): props novas precisam ser estáveis (`useCallback`/`useMemo`).
- Datas no formato `yyyy-MM-dd`; "hoje" = `hojeBrasilia()` de `src/lib/utils.js`.
- Textos em português, mesmo tom das telas atuais.

## Review Focus

1. Nome com acento/maiúscula diferente ("josé" acha "José", "JOSE" acha "José") — teste em Task 1.
2. `dia_semana` salvo em formatos variados no banco ("Qui", "quinta", "Quinta-feira") — a turma tem que aparecer e ordenar certo; teste em Task 1.
3. "Ver na agenda" com filtro de professor/espaço que esconderia a aula — os filtros voltam para "todos" antes de navegar; verificação manual em Task 4.
4. Troca em que a entrada na turma nova funciona e a saída da antiga falha — a aluna não pode sumir das duas; a mensagem diz que ela ficou nas duas; teste em Task 2.
5. Aluna sem turma fixa e sem agendamento — painel mostra estado vazio, não quebra; verificação manual em Task 4.

---

### Task 1: Lógica pura da busca e do dia da semana

**Files:**
- Create: `gestao_web/src/lib/diaSemana.js`
- Create: `gestao_web/src/lib/diaSemana.test.js`
- Create: `gestao_web/src/lib/buscaAlunoAgenda.js`
- Create: `gestao_web/src/lib/buscaAlunoAgenda.test.js`
- Modify: `gestao_web/src/pages/PerfilAluno.jsx:1030-1061` (remover `_semAcento`, `_MAPA_DIA`, `normalizarDiaSemana`, `ordemDiaSemana` locais e importar de `../lib/diaSemana`; `DIAS_CANONICOS` vai junto para o lib)

**Interfaces:**
- Produces:
  - `normalizarDiaSemana(valor: string): string` e `ordemDiaSemana(valor: string): number` (0=domingo…6=sábado, 99 se desconhecido) — mesmo comportamento das funções atuais do `PerfilAluno`.
  - `filtrarAlunosPorNome(alunos: {id, nome_completo}[], termo: string, limite = 8): {id, nome_completo}[]`
  - `turmasFixasDaAluna(aulas: Aula[], matriculasFixas: {aula_id, alunos: {id}}[], alunoId: number): Aula[]` — ordenadas por dia e horário.
  - `turmasParaTroca(aulas: Aula[], aulaAtual: Aula, matriculasFixas, alunoId: number, hoje: string): (Aula & { ocupados: number, lotada: boolean })[]`
  - `proximaDataDaTurma(aula: Aula, hoje: string): string | null` — próxima data (`yyyy-MM-dd`, podendo ser hoje) em que a turma recorrente acontece; `null` se o dia é desconhecido ou a turma já está encerrada até lá.
  - `Aula` = linha de `agenda` como vem de `gradeService.listarGrade('admin')`: `{ id, atividade, dia_semana, horario, capacidade, eh_recorrente, data_fim, modalidade_id, professores: {nome}, modalidades: {id, nome} }`.

- [ ] **Step 1: Escrever os testes que falham**

`diaSemana.test.js`:
```js
it.each([['Qui', 'Quinta-feira'], ['quinta', 'Quinta-feira'], ['Sábado', 'Sábado'], ['sabado', 'Sábado']])(
  'normalizarDiaSemana(%s) = %s', (entrada, saida) => expect(normalizarDiaSemana(entrada)).toBe(saida));
it('ordemDiaSemana: segunda=1, desconhecido=99', () => {
  expect(ordemDiaSemana('Segunda-feira')).toBe(1);
  expect(ordemDiaSemana('xyz')).toBe(99);
});
```

`buscaAlunoAgenda.test.js` (fixtures inline):
```js
const alunos = [{ id: 1, nome_completo: 'José Silva' }, { id: 2, nome_completo: 'Ana Souza' }, { id: 3, nome_completo: 'Joana Lima' }];
it('acha ignorando acento e maiúscula', () => {
  expect(filtrarAlunosPorNome(alunos, 'jose').map(a => a.id)).toEqual([1]);
  expect(filtrarAlunosPorNome(alunos, 'JO').map(a => a.id)).toEqual([1, 3]);
});
it('menos de 2 letras não busca', () => expect(filtrarAlunosPorNome(alunos, 'j')).toEqual([]));
it('o limite corta a lista', () => expect(filtrarAlunosPorNome(alunos, 'jo', 1).map(a => a.id)).toEqual([1]));

const aulas = [
  { id: 10, dia_semana: 'Qui', horario: '18:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 5, capacidade: 2 },
  { id: 11, dia_semana: 'segunda-feira', horario: '19:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 5, capacidade: 2 },
  { id: 12, dia_semana: 'segunda-feira', horario: '07:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 5, capacidade: 1 },
  { id: 13, dia_semana: 'terça-feira', horario: '08:00:00', eh_recorrente: true, data_fim: '2026-11-01', modalidade_id: 5, capacidade: 5 },
  { id: 14, dia_semana: 'terça-feira', horario: '08:00:00', eh_recorrente: true, data_fim: null, modalidade_id: 9, capacidade: 5 },
];
const fixas = [{ aula_id: 10, alunos: { id: 1 } }, { aula_id: 12, alunos: { id: 2 } }];

it('turmasFixasDaAluna ordena por dia e horário', () => {
  const fixasJose = [...fixas, { aula_id: 11, alunos: { id: 1 } }];
  expect(turmasFixasDaAluna(aulas, fixasJose, 1).map(a => a.id)).toEqual([11, 10]);
});
it('turmasParaTroca: mesma modalidade, não encerrada, sem a atual e sem onde já está; marca lotada', () => {
  const r = turmasParaTroca(aulas, aulas[0], fixas, 1, '2026-11-26');
  expect(r.map(a => a.id)).toEqual([12, 11]);
  expect(r.find(a => a.id === 12)).toMatchObject({ ocupados: 1, lotada: true });
  expect(r.find(a => a.id === 11)).toMatchObject({ ocupados: 0, lotada: false });
});
it('proximaDataDaTurma', () => {
  // 2026-11-26 é quinta-feira
  expect(proximaDataDaTurma(aulas[0], '2026-11-26')).toBe('2026-11-26');
  expect(proximaDataDaTurma(aulas[1], '2026-11-26')).toBe('2026-11-30');
  expect(proximaDataDaTurma(aulas[3], '2026-11-26')).toBeNull();
  expect(proximaDataDaTurma({ ...aulas[1], dia_semana: '???' }, '2026-11-26')).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix gestao_web test -- src/lib/diaSemana.test.js src/lib/buscaAlunoAgenda.test.js`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar `diaSemana.js` (mover do PerfilAluno) e `buscaAlunoAgenda.js`; trocar o PerfilAluno para importar**

Comparação de nome: `normalize('NFD')` sem diacríticos, minúsculo, `includes`. `ocupados` = número de `matriculasFixas` com aquele `aula_id`. Encerrada = `data_fim` não nula e `<= hoje` (para `proximaDataDaTurma`: `data_fim` não nula e `<=` a data encontrada). Ordem de `turmasParaTroca` igual à de `turmasFixasDaAluna`.

- [ ] **Step 4: Rodar os testes e ver passar, e a suíte inteira continuar verde**

Run: `npm --prefix gestao_web test`
Expected: PASS em tudo.

- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/lib/diaSemana.js gestao_web/src/lib/diaSemana.test.js gestao_web/src/lib/buscaAlunoAgenda.js gestao_web/src/lib/buscaAlunoAgenda.test.js gestao_web/src/pages/PerfilAluno.jsx
git commit -m "feat(agenda): lógica da busca de aluno e dia da semana compartilhado"
```

---

### Task 2: Serviços — próximas agendadas e troca de turma fixa

**Files:**
- Modify: `gestao_web/src/services/agendamentoService.js` (nova função)
- Modify: `gestao_web/src/services/gradeService.js` (nova função)
- Test: `gestao_web/src/services/agendamentoService.test.js`, `gestao_web/src/services/gradeService.test.js`

**Interfaces:**
- Produces:
  - `agendamentoService.listarProximasAgendadas(alunoId: number, hoje: string): Promise<{ id, aula_id, data_aula, agenda: { atividade, horario } }[]>` — `presencas` com `aluno_id = alunoId`, `status = 'agendado'`, `data_aula >= hoje`, ordenadas por `data_aula`; lança o erro do Supabase.
  - `gradeService.trocarTurmaFixa({ alunoId, aulaAntigaId, aulaNovaId }): Promise<void>` — **primeiro** insere `agenda_fixa { aluno_id, aula_id: aulaNovaId }`, **depois** apaga `{ aluno_id, aula_id: aulaAntigaId }`. Se o insert falhar, lança o erro (nada mudou). Se o delete falhar, lança `Error('A aluna entrou na nova turma, mas não saiu da antiga. Remova a antiga pelo perfil dela.')`.

- [ ] **Step 1: Escrever os testes que falham** (padrão `criarQueryMock`, como nos testes atuais desses arquivos)

```js
it('listarProximasAgendadas filtra aluno, status agendado e a partir de hoje', async () => {
  const { query, chamadas } = criarQueryMock({ data: [{ id: 1 }], error: null });
  supabase.from.mockReturnValue(query);
  expect(await agendamentoService.listarProximasAgendadas(7, '2026-11-26')).toEqual([{ id: 1 }]);
  expect(supabase.from).toHaveBeenCalledWith('presencas');
  expect(chamadas).toContainEqual(['eq', 'aluno_id', 7]);
  expect(chamadas).toContainEqual(['eq', 'status', 'agendado']);
  expect(chamadas).toContainEqual(['gte', 'data_aula', '2026-11-26']);
});
```
`gradeService.trocarTurmaFixa` — três testes, com um `criarQueryMock` por chamada de `supabase.from` (`mockImplementationOnce`):
- `entra na nova antes de sair da antiga`: 1ª chamada contém `['insert', { aluno_id: 7, aula_id: 11 }]`; 2ª contém `['delete']` e `['match', { aluno_id: 7, aula_id: 10 }]`.
- `se não consegue entrar na nova, não sai da antiga`: insert com `error` → rejeita; `supabase.from` chamado 1 vez.
- `se entrou mas não saiu, avisa que ficou nas duas`: delete com `error` → `rejects.toThrow('A aluna entrou na nova turma, mas não saiu da antiga')`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix gestao_web test -- src/services/agendamentoService.test.js src/services/gradeService.test.js`
Expected: FAIL (funções não existem).

- [ ] **Step 3: Implementar as duas funções** (select de `listarProximasAgendadas`: `'id, aula_id, data_aula, agenda ( atividade, horario )'`)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix gestao_web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gestao_web/src/services/agendamentoService.js gestao_web/src/services/agendamentoService.test.js gestao_web/src/services/gradeService.js gestao_web/src/services/gradeService.test.js
git commit -m "feat(agenda): serviços de próximas agendadas e troca de turma fixa"
```

---

### Task 3: Destaque de aula no calendário

**Files:**
- Modify: `gestao_web/src/pages/Agenda/components/CalendarioGrade.jsx:159-210`

**Interfaces:**
- Produces: prop nova `idDestacado?: string | null` em `CalendarioGrade`. Quando `event.idUnico === idDestacado`, o evento recebe um contorno visível (ex.: `ring-4 ring-primary ring-offset-2`), além das classes atuais. `idUnico` já é `${aula.id}-${yyyy-MM-dd}` (`calendarioParser.js`).

- [ ] **Step 1:** Fazer o `eventPropGetter` considerar `idDestacado`, criado com `useCallback([idDestacado])` dentro do `CalendarioGrade` (o objeto `CALENDAR_COMPONENTS` continua no escopo do módulo). Sem `idDestacado`, o resultado é idêntico ao atual.
- [ ] **Step 2:** `npm --prefix gestao_web run build` — Expected: build sem erro. `npm --prefix gestao_web run lint` — Expected: sem erros novos.
- [ ] **Step 3: Commit**

```bash
git add gestao_web/src/pages/Agenda/components/CalendarioGrade.jsx
git commit -m "feat(agenda): destacar uma aula no calendário"
```

---

### Task 4: Busca e painel da aluna na Agenda

**Files:**
- Create: `gestao_web/src/pages/Agenda/components/BuscaAlunoAgenda.jsx`
- Create: `gestao_web/src/pages/Agenda/components/PainelAlunoAgenda.jsx`
- Modify: `gestao_web/src/pages/Agenda/Agenda.jsx` (cabeçalho e estado)

**Interfaces:**
- Consumes: Task 1 (`filtrarAlunosPorNome`, `turmasFixasDaAluna`, `turmasParaTroca`, `proximaDataDaTurma`, `normalizarDiaSemana`), Task 2 (`listarProximasAgendadas`, `trocarTurmaFixa`), Task 3 (`idDestacado`), e os já existentes `alunosService.listarFaltasPendentesReposicao(alunoId)` (contagem de aulas em haver), `agendamentoService.cancelarAgendamento(id)`, `ModalConfirmacao` de `components/ui/Modal`.
- Produces:
  - `BuscaAlunoAgenda({ alunos, onSelecionar(aluno) })` — campo com lista de sugestões (até 8), navegável por teclado (↑/↓/Enter/Esc).
  - `PainelAlunoAgenda({ aluno, aulas, matriculasFixas, onVerNaAgenda({ aulaId, data }), onFechar, onAlterado() })` — painel lateral à direita com: nome; "Aulas em haver: N"; seção **Turmas fixas** (dia normalizado, horário `HH:mm`, atividade, professor; botões **Ver na agenda** e **Trocar horário**); seção **Próximas aulas agendadas** (data `dd/MM`, horário, atividade; botões **Ver na agenda** e **Desmarcar**); estados vazios "Nenhuma turma fixa." / "Nenhuma aula agendada.".
  - **Trocar horário** abre, dentro do painel, a lista de `turmasParaTroca` (mostrando `ocupados/capacidade` e "Lotada" quando for o caso); escolher uma abre `ModalConfirmacao` "Trocar <atividade> de <dia> às <hora> por <dia> às <hora>?" (com "Esta turma está lotada." quando `lotada`); confirmar chama `trocarTurmaFixa`, mostra `showToast.success('Horário trocado!')` e chama `onAlterado()`. Erro → `showToast.error(err.message)`.
  - **Desmarcar** abre `ModalConfirmacao` "Desmarcar a aula de <dd/MM> às <HH:mm>? Ela fica como aula em haver."; confirmar chama `cancelarAgendamento(id)`, toast de sucesso, `onAlterado()`.
- Em `Agenda.jsx` (só `isAdmin`):
  - estado `alunaSelecionada` e `idDestacado`;
  - `BuscaAlunoAgenda` no cabeçalho, antes dos botões;
  - `onVerNaAgenda({ aulaId, data })`: `setFiltroProf('todos')`, `setFiltroEspaco('todos')`, `setCurrentView('week')`, `setCurrentDate(new Date(data + 'T12:00:00'))`, `setIdDestacado(`${aulaId}-${data}`)` e limpar após 4 s (limpar o timer ao desmontar). Para turma fixa a data é `proximaDataDaTurma(aula, hojeBrasilia())`; se `null`, botão desabilitado;
  - `onAlterado()`: `queryClient.invalidateQueries` de `['matriculas-fixas']`, `['agenda', 'dadosMes']`, `['agenda', 'proximas-agendadas', alunoId]` e `['aluno', alunoId, 'faltas-pendentes-reposicao']`.

- [ ] **Step 1: Implementar os dois componentes e a ligação na `Agenda.jsx`** (React Query para `listarProximasAgendadas` com a chave `['agenda', 'proximas-agendadas', alunoId]` e para a contagem de em haver com `['aluno', alunoId, 'faltas-pendentes-reposicao']`; usar os componentes de UI existentes — `Input`, `Button`, `ModalConfirmacao`)
- [ ] **Step 2: Build, testes e lint**

Run: `npm --prefix gestao_web run build && npm --prefix gestao_web test && npm --prefix gestao_web run lint`
Expected: build ok, testes verdes, sem erros novos de lint.

- [ ] **Step 3: Verificação na tela — contra o STAGING, nunca produção**

Conferir `VITE_SUPABASE_URL` em `gestao_web/.env.local`. Para testar trocar/desmarcar, subir o dev server apontando para o projeto de staging `mytmreoqysbxisszludl` (ex.: `gestao_web/.env.staging.local` com a URL e a anon key de staging, rodando `npm --prefix gestao_web run dev -- --mode staging`; arquivos `*.local` já estão no `.gitignore`). Entrar com a conta admin de teste do staging (ver memória `iluminus-staging-test-credentials`). Verificar:
  1. "jose"/"JOSÉ" acham a mesma aluna; 1 letra não sugere nada.
  2. Painel de aluna com fixas e agendadas mostra as duas seções e o número de aulas em haver.
  3. Com filtro de professor ativo que esconderia a aula, **Ver na agenda** volta os filtros para "todos", vai para a semana certa e destaca a aula por ~4 s.
  4. **Trocar horário**: só aparecem turmas da mesma modalidade; trocar e conferir que a grade e o perfil da aluna mostram a turma nova e não a antiga.
  5. **Desmarcar**: a aula some das próximas e o número de aulas em haver sobe 1.
  6. Aluna sem nada: estados vazios, sem erro no console.
  7. Professor logado não vê a busca.

- [ ] **Step 4: Commit**

```bash
git add gestao_web/src/pages/Agenda/components/BuscaAlunoAgenda.jsx gestao_web/src/pages/Agenda/components/PainelAlunoAgenda.jsx gestao_web/src/pages/Agenda/Agenda.jsx
git commit -m "feat(agenda): busca de aluno com painel para ver, trocar e desmarcar"
```

---

### Task 5: PR

- [ ] **Step 1:** Commitar o spec e este plano no mesmo branch (`docs/superpowers/specs/2026-11-26-agenda-busca-aluno-e-fechamento-design.md`, `docs/superpowers/plans/2026-11-26-agenda-busca-aluno.md`).
- [ ] **Step 2:** Abrir o PR no `devpedroschuster/Iluminus_SaaS` com o resumo e o resultado da verificação da Task 4. Sem migration: o merge pode publicar o frontend direto.
