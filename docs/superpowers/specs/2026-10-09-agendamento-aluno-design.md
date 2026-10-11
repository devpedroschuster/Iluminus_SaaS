# Agendamento pelo aluno (Área do Aluno) — design

- **Issues:** ILU-78 (agendar), ILU-79 (cancelar), ILU-80 itens 1–9 (dados da aba de agenda). O item 10 da ILU-80 (status "Atrasado" na aba Mensalidades) fica fora.
- **Data:** 2026-10-09
- **Status:** aprovado em conversa, seção a seção; aguardando revisão desta spec.

## 1. Objetivo

Liberar o login para os alunos com o agendamento funcionando e as regras do espaço valendo **no servidor**:

- O aluno vê as aulas que pode fazer nos próximos 14 dias.
- Ele agenda e cancela respeitando o prazo de 1h, a matrícula, o limite semanal, a validade do plano e a lotação.
- A tela mostra o motivo de cada bloqueio.

Hoje o agendar e o cancelar do app falham (404 por parâmetros errados, e cancelar só é permitido a admin). Além disso, a tela calcula sozinha regras erradas: consumo mensal, "Agendado" sem data, vagas estáticas e professor sempre "A definir".

**Sucesso:**

- Um aluno real agenda e cancela pelo app no staging e em produção.
- As 9 regras abaixo são recusadas pelo servidor mesmo quando a RPC é chamada direto pela API.
- A tela mostra os mesmos números que o servidor usa.

## 2. Regras de negócio (decididas pelo usuário em 2026-10-09)

1. **1h:** só é possível agendar e cancelar até 1h antes do início da aula.
2. **Só modalidades matriculadas:** a modalidade da aula precisa estar em `alunos.modalidades_selecionadas`, porque os repasses dependem disso. Vale para todos os planos, inclusive os livres.
3. **Limite semanal com fixos:** `planos.regras_acesso[].limite` é por semana e por área. Os horários fixos (`agenda_fixa`) consomem a cota.
4. **Plano vencido:** bloqueia a partir do 5º dia de vencido.
5. **Presença presumida:** o que o aluno agenda pelo app nasce `agendado` e vira `presente` sozinho depois da aula, a menos que a equipe marque falta.
6. **A confirmação automática vale só para agendamentos do app.** Fixos e reservas do admin continuam manuais.
7. **Horizonte:** 14 dias, de hoje até hoje+13, validado também no servidor.
8. **Cancelar com aviso (≥ 1h) libera a cota da semana**, inclusive de aula fixa. O aluno pode cancelar o próprio fixo pelo app. Falta sem aviso continua contando.
9. **Capacidade:** `COALESCE(modalidades.capacidade_padrao, agenda.capacidade, 15)`, a mesma conta do admin (`verificar_disponibilidade_v2`).
10. **Registro de falta:** a equipe registra "Falta sem aviso" pelo botão novo na lista de presença da turma (seção 6).

## 3. Definições (valem para todas as funções)

- **Fuso:** tudo em `America/Sao_Paulo`. O banco roda em UTC.
  - `hoje = (now() at time zone 'America/Sao_Paulo')::date`;
  - `inicio(aula, d) = (d + agenda.horario) at time zone 'America/Sao_Paulo'`, que é um `timestamptz`;
  - `fim = inicio + coalesce(duracao_minutos, 60) min`.
- **Semana:** de segunda a domingo, `date_trunc('week', d)`.
- **A aula acontece na data `d`** (`_aula_ocorre`) quando:
  - `agenda.ativa is not false`;
  - `agenda.data_fim is null or d < agenda.data_fim`. A `data_fim` é exclusiva: "a turma não aparecerá mais a partir de" (`encerrarAula`).
  - a data bate: recorrente (`eh_recorrente is not false`) com `lower(dia_semana)` igual ao dia da semana de `d`, ou não recorrente com `data_especifica = d`. Em recorrentes a `data_especifica` é ignorada, como no calendário do admin.
  - `d` não é feriado com `bloqueia_agenda = true`;
  - `agenda.modalidade_id is not null`. As 27 aulas ativas sem modalidade são feriados, reuniões, workshops e ensaios, e nunca aparecem para o aluno.
- **Fixo válido do aluno A na aula X na data `d`:**
  - existe `agenda_fixa(A, X)`;
  - `_aula_ocorre(X, d)`;
  - A está ativo;
  - `data_inicio_plano is null or d >= data_inicio_plano`, como no calendário do admin;
  - **não há** linha em `presencas` para (A, X, `d`). Se há, a linha manda.
- **Ocupação de (X, `d`):** linhas de `presencas` com `status in ('agendado','presente')`, somadas aos fixos válidos de qualquer aluno sem linha.
- **Uso semanal do aluno A na área R na semana W:**
  - linhas de A em W, em aulas de modalidade da área R, com `status in ('agendado','presente','falta')`, fora de feriado que bloqueia;
  - somadas às ocorrências de fixos válidos de A em W, em aulas da área R.
  - `cancelado` não conta.
  - Uma reserva `agendado` numa aula que não acontece mais naquela data (`_aula_ocorre` falso: encerrada, desativada ou com feriado cadastrado depois) **não conta**: o aluno nem a vê na lista para cancelar. `presente` e `falta` contam sempre. (Achado da revisão final.)
- **Status do aluno na aula (`meu_status`):** o `status` da linha dele em `presencas`; `'fixo'` se ele tem fixo válido sem linha; `null` se nenhum dos dois.
- **Linha do app:** a coluna nova `presencas.agendado_pelo_app boolean not null default false`. A `origem` mantém o significado atual:
  - `avulso`: reserva comum;
  - `fixo`;
  - `agendamento`: presença confirmada a partir de uma reserva, que o "desfazer" reverte em vez de apagar.

## 4. Avaliação (`_avaliar_agendamento`)

**Assinatura:** `_avaliar_agendamento(p_aluno_id bigint, p_aula_id bigint, p_data date, p_agora timestamptz default now()) returns jsonb`.

A resposta sai da primeira regra que falhar:

| Ordem | Código | Condição de bloqueio | Mensagem |
|---|---|---|---|
| 1 | `nao_ocorre` | `_aula_ocorre` falso | "Esta aula não acontece nesta data." |
| 2 | `fora_matricula` | modalidade fora de `modalidades_selecionadas`, ou o plano sem regra para a área da modalidade | "Esta aula não faz parte da sua matrícula." |
| 3 | `fora_janela` | `p_data < hoje` ou `p_data > hoje + 13` | "Só é possível agendar aulas dos próximos 14 dias." |
| 4 | `prazo_encerrado` | `p_agora > inicio - 1h` | "Agendamento encerrado (até 1h antes da aula)." |
| 5 | `plano_nao_iniciado` | `data_inicio_plano > p_data` | "Seu plano começa em DD/MM." |
| 5 | `plano_vencido` | `data_fim_plano is not null and p_data >= data_fim_plano + 5` | se `data_fim_plano < hoje`: "Seu plano venceu em DD/MM. Renove para agendar."; senão: "Seu plano vence em DD/MM. Renove para agendar esta aula." |
| 6 | `limite_semanal` | o limite da área ≠ 999 e o uso semanal (semana de `p_data`) ≥ limite | "Limite da semana atingido: N de N aulas de <Área>." |
| 7 | `lotada` | ocupação ≥ capacidade | "Turma lotada." |

- **Antes da tabela:** o aluno sem plano (`plano_id is null`) recebe `sem_plano`, "Você não tem um plano ativo. Fale com a recepção."
- **O que a função devolve:**
  - `{pode, codigo, motivo, inicio, capacidade, ocupacao, area, limite, uso}`;
  - mais o `meu_status` (seção 3), para quem chama distinguir "já agendado" de "pode agendar".
- **Quem pode executá-la:** é interna. Nem `anon` nem `authenticated` têm `EXECUTE` (o `REVOKE ... FROM PUBLIC` vale também para as auxiliares `_aula_ocorre`, `_ocupacao` e `_uso_semanal`).
- **Para que serve o `p_agora`:** existe só para os testes de prazo. As funções públicas usam `now()`.

## 5. Funções públicas (migration `ilu78_agendamento_aluno`)

Regras comuns às três funções:

- Todas são `SECURITY DEFINER` com `search_path` fixo.
- `EXECUTE` só para `authenticated` e `service_role`; `REVOKE` de `PUBLIC` e `anon`.
- Nenhuma recebe `aluno_id`: o aluno vem de `alunos.auth_id = auth.uid()`.
  - Sem `auth.uid()` ou sem aluno vinculado, a função recusa com "Faça login novamente.".
  - Se o login estiver ligado a **mais de um** cadastro de aluno (`alunos.auth_id` não é único), recusa com "Seu login está ligado a mais de um cadastro. Fale com a recepção.", em vez de agir num cadastro qualquer. (Achado da revisão final.)
  - Com `ativo = false`, recusa com "Sua conta está desativada. Entre em contato com a gestão do espaço.".
- Erros saem como `RAISE EXCEPTION '<mensagem>'` (`P0001`), e o front mostra `error.message`.

### 5.1 `listar_aulas_aluno(p_de date default null, p_ate date default null) returns jsonb`

O intervalo é limitado a `[hoje, hoje+13]`.

**Quais ocorrências aparecem:** só as com `inicio > now()` (aulas já começadas somem). Entre essas, as que:

- passam nos códigos 1–2 (`nao_ocorre`, `fora_matricula`), ou
- em que o aluno já tem linha (qualquer status) ou fixo válido. Assim ele vê uma reserva feita pelo admin fora da matrícula.

**Resposta:**

```json
{
  "hoje": "2026-10-09",
  "plano": { "nome": "…", "data_inicio": "…", "data_fim": "…", "bloqueia_a_partir_de": "data_fim+5",
             "regras": [{ "area": "Dança", "limite": 2 }] },
  "feriados": [{ "data": "…", "descricao": "…" }],
  "consumo": [{ "semana_inicio": "2026-10-06", "area": "Dança", "limite": 2, "uso": 1, "livre": false }],
  "aulas": [{
    "aula_id": 1, "data": "2026-10-14", "horario": "19:00", "inicio": "…timestamptz…", "duracao_minutos": 60,
    "atividade": "…", "modalidade": "…", "area": "Dança", "professor": "primeiro nome ou null",
    "capacidade": 15, "ocupacao": 9,
    "meu_status": null, "pode_agendar": true, "pode_cancelar": false,
    "codigo": null, "motivo": null
  }]
}
```

- **`consumo`:** uma entrada por semana tocada pelo intervalo e por área das regras do plano.
- **Aluno sem plano** (`plano_id is null`): `plano: null`, `consumo: []` e `aulas` só com o que ele já tem agendado ou fixo (nenhuma com `pode_agendar`). A tela mostra "Sem plano ativo".
- **`pode_cancelar`:** `meu_status in ('agendado','fixo')` e faltando ≥ 1h.
- **Quando já está agendado:** com `meu_status` em `agendado`, `presente` ou `fixo`, `pode_agendar` é false e o `codigo` e o `motivo` ficam nulos, porque a tela mostra o status.
- **Quando o prazo de cancelamento já passou:** com `meu_status in ('agendado','fixo')` e faltando menos de 1h, o `codigo` é `cancelamento_encerrado` e o motivo, "Para cancelar agora, fale com a recepção.".
- **Privacidade:** outros alunos aparecem só como contagem. O professor aparece só pelo primeiro nome, porque o RLS de `professores` não deixa o aluno ler a tabela.

### 5.2 `agendar_aula(p_aula_id bigint, p_data date) returns jsonb`

- **Substitui** `agendar_aula(bigint, bigint, timestamptz)`: a assinatura antiga é removida. Hoje ela só é chamada pela `AreaAluno`, e com parâmetros errados.
- **Travas:**
  1. `pg_advisory_xact_lock(hashtextextended('ilu78:aluno:'||aluno_id, 0))`, para que dois agendamentos simultâneos do mesmo aluno não estourem o limite semanal;
  2. `pg_advisory_xact_lock(hashtextextended('ilu78:aula:'||p_aula_id||':'||p_data, 0))`, para que dois alunos não peguem a mesma última vaga.

  A ordem é sempre aluno e depois aula.
- **Avaliação:** depois das travas, `_avaliar_agendamento(..., now())`.
  - Com `meu_status` em `agendado` ou `presente`, a função recusa com "Você já está agendado nesta aula.".
  - Com `meu_status = 'fixo'`, recusa com "Esta aula já é seu horário fixo.".
  - Com `meu_status = 'falta'`, recusa com "Esta aula já tem registro de falta.".
  - Se `pode` for falso, recusa com o `motivo`.
- **Gravação:**
  - **Se existe linha `cancelado`:** a linha é reativada, porque a tabela só permite uma por aluno, aula e data. A reativação faz `status='agendado'`, `cancelado_em=null`, `cancelado_motivo=null` e `data_checkin=null`. Se a origem for `fixo`, mantém `fixo` com `agendado_pelo_app=false`, e o fixo volta a ser manual (regra 6). Nos outros casos, grava `agendado_pelo_app=true`.
  - **Se não existe linha:** insere `(aluno, aula, data, 'agendado', 'avulso', agendado_pelo_app=true)`.
- **Resposta:** `{ "status": "agendado", "aula_id": …, "data": "…" }`.

### 5.3 `cancelar_meu_agendamento(p_aula_id bigint, p_data date) returns jsonb`

- **Travas e prazo:** usa as mesmas travas do agendar. Exige `now() <= inicio - 1h`; fora disso, recusa com "Cancelamento só até 1h antes da aula. Fale com a recepção.".
- **Linha `agendado` existente:** faz `status='cancelado'`, `cancelado_em=now()`, `cancelado_motivo='Cancelado pelo aluno no app'`. O gatilho que já existe (`trg_notificar_cancelamento_aviso`) avisa o professor.
- **Fixo válido sem linha:**
  - insere a linha `(…, 'cancelado', 'fixo', cancelado_em, cancelado_motivo)`;
  - insere em `notificacoes_pendentes` com `tipo 'aluno_cancelou_aviso'` e o mesmo payload do gatilho (`atividade`, `horario`, `data_aula`, `motivo`), se a aula tiver professor.
- **Qualquer outro caso:** recusa com "Você não tem agendamento nesta aula.".
- **Resposta:** `{ "status": "cancelado", "aula_id": …, "data": "…" }`.

### 5.4 Confirmação automática

`fn_confirmar_presencas_automaticas(p_margem_minutos int default 30)`. A assinatura é a mesma; o corpo é reescrito:

- **Quais linhas:** só `status='agendado' and agendado_pelo_app` com `fim + margem < now()`, calculando `fim` no fuso de Brasília, **e só se a aula aconteceu** (`_aula_ocorre`): reserva numa aula que virou feriado, foi encerrada ou desativada depois de agendada não vira `presente` (evita presença falsa na frequência e no repasse do plano livre; achado da revisão final). Hoje a função compara horário local com UTC e confirmaria cerca de 1h30 **antes** de a aula começar.
- **O que grava:** `status='presente'`, `data_checkin = fim` e `origem='agendamento'`, igual ao check-in manual de uma reserva. Assim "Desmarcar" volta a linha para `agendado` em vez de apagá-la.
- **Permissões:** `REVOKE EXECUTE` de `PUBLIC`, `anon` e `authenticated`; fica para `service_role` e para o dono, `postgres`. Hoje qualquer visitante pode chamá-la.
- **Agendamento:** `cron.schedule('confirmar-presencas-app', '*/15 * * * *', 'select public.fn_confirmar_presencas_automaticas()')`. Produção já tem o pg_cron 1.6.4. No staging, a extensão é conferida e habilitada se faltar.
- **Interação com "Desmarcar":** se alguém desmarcar uma presença presumida depois da aula, a linha volta para `agendado` e o cron a confirma de novo. O caminho certo para registrar ausência é "Falta sem aviso" (seção 6).

### 5.4b Fecha o atalho de apagar a reserva pela API

A política de RLS `aluno_cancela_propria_presenca` (DELETE em `presencas`, para o aluno dono e `status = 'agendado'`) é removida. Hoje ela deixa o aluno apagar a própria reserva direto pela API, a qualquer hora, o que burla o prazo de 1h e a regra "falta sem aviso conta": o aluno falta e apaga a reserva antes do cron confirmar.

- O app não usa esse caminho: o cancelamento é pela RPC.
- O aluno continua **sem** INSERT e UPDATE em `presencas` (as políticas são só de admin e professor), então as RPCs são o único caminho de escrita do aluno.

### 5.5 O que não muda

- `verificar_disponibilidade_v2`, a reserva e o check-in do admin, e o "forçar" lotação.
- Admins inserem em `presencas` direto, sem as travas: podem lotar de propósito, como hoje.
- `cancelar_agendamento`, que continua só para admin, fica **sem uso** depois desta mudança e vira issue de código morto.

### 5.6 Migration "down"

`supabase/migrations-down/<mesmo nome>.sql`:

- `cron.unschedule('confirmar-presencas-app')`;
- remove `listar_aulas_aluno`, `agendar_aula(bigint, date)`, `cancelar_meu_agendamento` e as funções internas;
- recria a `agendar_aula(bigint, bigint, timestamptz)` da ILU-74, com os mesmos grants;
- recria a `fn_confirmar_presencas_automaticas` original, com os grants originais;
- recria a política `aluno_cancela_propria_presenca`;
- remove a coluna `presencas.agendado_pelo_app`.

## 6. Admin: registrar falta sem aviso

Em `pages/Agenda/components/ModalListaPresenca.jsx`, a lista da turma aberta pelo calendário, em qualquer data:

- **Botão novo "Falta sem aviso"** (só admin), em linhas de aluno, não de lead:
  - aparece com `status` `agendado` (inclui fixo sem linha) ou `presente`, e a data da lista ≤ hoje (Brasília);
  - grava `status='falta'` e `data_checkin=null` na linha existente. Para fixo sem linha, insere `('falta','fixo')`.
  - função nova `agendamentoService.registrarFaltaSemAviso(alunoId, aulaId, dataAula)`, no mesmo padrão "update por id e conferência do status" do resto do arquivo.
- **Rótulo:** o botão "Informar Falta", que grava `cancelado`, passa a se chamar **"Falta com aviso"**. O comportamento não muda; o nome passa a bater com o badge "Avisou que não vem".
- **Correção do "Desfazer" em linhas ausentes:** `removerFalta` passa a reverter `falta` também, além de `cancelado`, para `agendado`. Hoje, numa linha `falta`, ele não faz nada e não avisa.
- **Badge "App"** nas linhas com `agendado_pelo_app`, para a equipe saber que a presença é presumida. `listarChamadaCompleta` passa a selecionar a coluna.
- `Presenca.jsx` (a chamada rápida do dia) não muda.

## 7. Tela do aluno

- **`services/areaAlunoService.js`:**
  - `listarAulas()`, `agendar(aulaId, data)` e `cancelar(aulaId, data)`, finos sobre as RPCs;
  - em erro, lançam `Error` com a mensagem do servidor.
- **`lib/agendaAluno.js`** (funções puras, a partir do `hoje` devolvido pelo servidor):
  - `montarDias(hoje)`: 14 dias com rótulo ("Hoje", "Seg 13/10"…);
  - `aulasDoDia(aulas, data)`;
  - `consumoDaSemana(consumo, data)`;
  - `acaoDoCartao(aula)`: `{ tipo: 'agendar' | 'cancelar' | 'info', texto }`;
  - `avisoDoPlano(plano, hoje)`: `null`, `{ tom: 'aviso', texto }` para vencido há menos de 5 dias, ou `{ tom: 'bloqueio', texto }` para bloqueado.
- **`components/aluno/AbaAgendarAulas.jsx`:**
  - usa a query `['aulas-aluno']`, uma chamada para os 14 dias, invalidada depois de agendar ou cancelar;
  - **faixa de 14 dias** rolável, com ponto nos dias em que o aluno tem aula e feriados com a descrição;
  - **"Sua semana"**: o consumo por área da semana do dia escolhido;
  - **aviso de plano**, com o botão de WhatsApp que já existe quando bloqueado;
  - **cartões**: horário, modalidade, professor, vagas da data, badge do `meu_status` e o botão ou o motivo;
  - **cancelar** abre confirmação com o `Modal` que já existe;
  - **toasts** com a mensagem do servidor.
- **`pages/AreaAluno.jsx`:**
  - passa a renderizar `<AbaAgendarAulas>`;
  - perde `presencas-mes`, `agenda`, `feriados-semana`, `gerarProximosDias`, `vagas_ocupadas`, `handleAgendar` e `handleCancelar`.
- **Fica de fora:**
  - ILU-80 item 10 ("Atrasado" no dia do vencimento);
  - o botão "Visão Professor";
  - a data de nascimento vazia no perfil;
  - a navegação mobile (ILU-81).

## 8. Testes (escritos antes do código; RED antes de GREEN)

1. **SQL** `scripts/sql-tests/ilu78_agendamento_aluno.sql`, autodescartável, rodado no staging. O padrão é o mesmo da ILU-74/75/76: um único `DO`, papéis simulados com `SET LOCAL ROLE` e `request.jwt.claims`, e o fim em `RAISE EXCEPTION 'RESULTADO ILU-78: …'`. Casos:
   - **Permissões:** `anon` não executa as três públicas; `authenticated` não executa as internas; nem `anon` nem `authenticated` executam `fn_confirmar_presencas_automaticas`; a política `aluno_cancela_propria_presenca` não existe mais.
   - **Listagem:**
     - só aparecem as modalidades matriculadas;
     - a janela vai de hoje a hoje+13;
     - não aparecem feriado, aula inativa, aula encerrada (`d >= data_fim`) nem aula sem modalidade;
     - aparece a reserva do admin fora da matrícula;
     - o status por data vem certo (uma reserva antiga não marca outra semana);
     - a ocupação real e o consumo vêm certos.
   - **Agendar:**
     - grava `agendado`, `avulso` e `agendado_pelo_app`;
     - recusa duplicado, o próprio fixo e as datas fora da janela;
     - reativa uma linha cancelada (avulsa vira app; fixa volta a fixo manual).
   - **Prazo 1h** (via `_avaliar_agendamento` com `p_agora`): 61 min passa, 59 min bloqueia, e o horário é o de Brasília.
   - **Plano:** o 4º dia de vencido passa, o 5º bloqueia, o plano não iniciado bloqueia e o sem plano bloqueia.
   - **Limite semanal:**
     - o fixo conta;
     - o fixo cancelado libera;
     - a falta conta;
     - o cancelado não conta;
     - o fixo em feriado não conta;
     - a semana vai de segunda a domingo;
     - o livre (999) não tem limite;
     - áreas diferentes não se misturam.
   - **Lotação:** o fixo sem linha ocupa; a turma cheia recusa; a capacidade da modalidade tem prioridade sobre a da aula.
   - **Cancelar:**
     - com ≥ 1h cancela e o professor é avisado (pelo gatilho);
     - o fixo sem linha cria `cancelado` e a notificação;
     - com menos de 1h recusa;
     - sem agendamento recusa.
   - **Confirmação automática:**
     - confirma a linha do app cuja aula acabou há mais de 30 min (grava `origem` e `data_checkin`);
     - não confirma antes;
     - não toca reserva do admin, fixo nem `falta`;
     - não confirma aula que deixou de acontecer (feriado novo, aula desativada).
   - **Revisão final:** reserva em aula encerrada ou desativada não consome a cota; login ligado a dois cadastros é recusado.
   - **Desempenho:** a lista avalia cada aula uma vez (caso L6, que conta as chamadas de `_avaliar_agendamento`). Medido em produção depois da migration: um aluno com 98 aulas nos 14 dias levava 3,5 s, porque a CTE embutida repetia a avaliação a cada campo lido (~11x por aula). Corrigido com `AS MATERIALIZED` na migration `20261010120000`. Total: 50 casos.
   - **Teste da ILU-74:** é atualizado para a nova assinatura. Os testes da ILU-75 e da ILU-76 continuam passando.
2. **Down:** executada numa transação revertida, conferindo que tudo foi removido e a `agendar_aula` antiga voltou.
3. **HTTP real no staging,** com um aluno de teste logado:
   - listar, agendar, recusar acima do limite e cancelar;
   - **dois agendamentos em paralelo na última vaga**: exatamente um sucesso;
   - **o mesmo aluno agendando duas aulas em paralelo com cota 1**: exatamente um sucesso;
   - um aluno tentando apagar a própria reserva direto pela API (`DELETE /rest/v1/presencas`) não apaga nada;
   - limpeza dos dados `[TESTE ILU-78]`, com zero sobras.
4. **Vitest:**
   - `areaAlunoService` (parâmetros e mensagens de erro);
   - `agendaAluno`: 14 dias a partir do `hoje` do servidor, inclusive perto da meia-noite UTC; agrupamento; consumo da semana; cada ramo de `acaoDoCartao` e `avisoDoPlano`;
   - `agendamentoService.registrarFaltaSemAviso` e `removerFalta` com `falta`, usando `criarQueryMock`.

   Não há Testing Library no projeto: a lógica fica nas funções puras e os componentes ficam finos.
5. **Navegador:** no Preview do staging, em largura de celular, a aba com os dados do staging (agendar, cancelar, aviso de plano), mais o botão "Falta sem aviso" e o badge "App" no admin.
6. **Antes do PR:** lint, build e a suíte completa.

## 9. Deploy (ordem do `docs/DEPLOY.md`; cada passo de produção com confirmação do usuário)

1. **Migration:** staging primeiro (com os testes 1–3), depois produção.
   - É segura antes do front: o agendar e o cancelar atuais já falham, então remover a assinatura antiga não quebra nada que funcione.
   - A `listar_aulas_aluno` é nova e o front atual não a usa.
   - O cron começa sem nada para confirmar, já que nenhuma linha tem `agendado_pelo_app`.
2. Não há Edge Function nesta mudança.
3. PR, merge pelo usuário e publicação pela Vercel. O Preview do PR usa o Supabase de produção, então a tela nova só é testada no Preview depois do passo 1 em produção.

## 10. Fora do escopo (viram issues no time Iluminus)

- `cancelar_agendamento` sem uso (código morto).
- 28 reservas do admin (`avulso`/`agendado`) em datas passadas que nunca foram resolvidas.
- `fn_gerar_presencas_fixos` com `EXECUTE` para `anon`.
- ILU-80 item 10, que continua aberto na própria ILU-80.
