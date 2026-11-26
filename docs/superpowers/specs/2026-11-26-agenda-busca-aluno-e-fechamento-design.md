# Agenda: busca de aluno e fechamento da agenda

Data: 2026-11-26. Duas entregas independentes, cada uma com seu PR, nesta ordem:
1. Busca de aluno na Agenda (pequena, só tela).
2. Fechamento da agenda com aulas em haver (projeto, mexe no banco de produção).

---

## Parte 1 — Busca de aluno na Agenda

### Por quê
Quando uma aluna pede para trocar de horário, a recepção precisa achar onde ela está na grade e
alterar ali mesmo. Hoje a Agenda só filtra por espaço e professor, e a troca de turma fixa só existe
no perfil da aluna (`PerfilAluno.jsx`, parte de turmas: `executarMatricula` / `executarRemocao` em
`agenda_fixa`).

### Abordagens
- **A — a busca filtra a grade** para mostrar só as aulas da aluna. Simples, mas a troca de turma
  fixa continuaria em outra tela.
- **B — a busca abre um painel da aluna** com os horários dela e ações. **Escolhida pelo usuário**:
  resolve "achar e alterar" num lugar só.
- (C — link para o perfil — descartada: é o que já existe, com um clique a mais.)

### Como fica
- Caixa de busca por nome no topo da Agenda (com autocompletar, mesma lista de alunos ativos que a
  Agenda já carrega em `alunosService.listarAtivos`). *Decisão minha:* só para admin, porque trocar
  turma é ação de admin.
- Ao escolher a aluna abre um painel lateral com:
  - **Turmas fixas** (dia, horário, atividade, professor). Ações: **Ver na agenda** e **Trocar horário**.
  - **Próximas aulas agendadas** (avulsas/agendamentos com status `agendado`, a partir de hoje).
    Ações: **Ver na agenda** e **Desmarcar**. *Decisão minha:* "Desmarcar" usa a mesma ação do
    "Remover" da chamada (`agendamentoService.cancelarAgendamento`), que numa presença `agendado`
    grava `cancelado` — ou seja, fica como reposição pendente, igual a desmarcar pela chamada hoje.
    Nenhuma regra nova.
  - *Decisão minha:* número de **reposições pendentes** (aulas em haver) da aluna, como informação.
- **Ver na agenda**: o calendário vai para a semana daquela aula, em visão semanal, e destaca o evento
  por alguns segundos.
- **Trocar horário** (turma fixa): lista as turmas para onde ela pode ir e troca numa ação só
  (sai da antiga, entra na nova). Precisa respeitar as mesmas regras que o perfil já aplica
  (modalidade ligada ao plano da aluna — ILU-127 —, quantidade de vezes da modalidade, capacidade).
  O construtor deve reaproveitar essa regra em vez de duplicá-la.

### Fica para o construtor
Layout exato do painel; se a busca fica num campo fixo ou num botão; como extrair a regra de troca do
`PerfilAluno` para uso compartilhado; o que fazer com uma presença da turma antiga já gerada para o
dia seguinte pela geração diária (comportamento atual do perfil serve de referência — não piorar).

---

## Parte 2 — Fechar a agenda

### Por quê
O estúdio precisa fechar por períodos (recesso de fim de ano, por exemplo), não só dias soltos, e às
vezes só uma faixa de horas de um dia. Quem estava marcado deve ser desmarcado sozinho e ficar com a
aula **em haver**. Hoje:
- o botão **Bloqueios (Feriados)** (`ModalFeriados.jsx`, tabela `feriados` com `data` única e
  `bloqueia_agenda`) só fecha **um dia inteiro**;
- num dia bloqueado a geração diária das fixas (`fn_gerar_presencas_fixos`) simplesmente pula o dia e
  a aula não conta como devida: **feriado não gera aula em haver**;
- aulas que já estavam agendadas antes do bloqueio ficam como estão.

O usuário quer que feriado passe a seguir a mesma regra do fechamento.

### Regras decididas com o usuário
1. Um fechamento pode ser: um dia inteiro, um período de vários dias, ou uma faixa de horas
   (ex.: 14h às 18h).
2. Ao fechar, o sistema **desmarca automaticamente** quem estava nas aulas afetadas (fixas e
   agendadas) e essas aulas ficam **em haver**.
3. Feriado segue a mesma regra (é um fechamento de um dia inteiro).
4. **Em haver = reposição pendente que já existe hoje.** A aula desmarcada vira uma presença com
   `status = 'cancelado'` e um motivo próprio do fechamento (ex.: `Agenda fechada: <motivo>`), e entra
   no fluxo atual de reposição (`listarFaltasPendentesReposicao`, `fn_resumo_frequencia_aluno`,
   seletor "é reposição de qual falta" na chamada). Ela **vale dentro do período do plano em que a
   aula caiu** — mesma regra da falta comum; ao renovar, deixa de aparecer.
5. **As alunas são avisadas dentro do app** (`AreaAluno`): um quadro com o fechamento e as aulas
   dela que ficaram em haver. Notificação no celular da aluna **não** entra (ver Fora do escopo).

### Propostas minhas aceitas pelo usuário (sem objeção)
6. **Reabrir** (apagar um fechamento que ainda não passou) **remarca** as alunas desmarcadas por ele,
   exceto aulas que já aconteceram e cancelamentos que já foram usados numa reposição
   (`reposicao_de_id` apontando para eles). Uma aula só volta se nenhum outro fechamento ainda a cobre.
7. **Feriados futuros já cadastrados** recebem o tratamento quando a mudança for publicada (quem
   estava marcado é desmarcado e fica em haver). Dias passados ficam como estão.

### Abordagens
- **Desmarcar tudo na hora de salvar o fechamento** (escolhida): a aluna vê a aula em haver e o
  aviso imediatamente e pode repor com antecedência; reabrir desfaz de uma vez.
- Desmarcar dia a dia, na véspera, pela geração diária — descartada: num recesso longo a aula em haver
  só apareceria um dia antes e o aviso chegaria aos pedaços.
- Manter "Bloqueios" separado de um novo "Fechamento" — descartada: duas telas para a mesma coisa, e o
  usuário quer que feriado siga a mesma regra.

### Como fica
**Tela (admin).** O botão **Bloqueios** vira o lugar de fechar a agenda: data de início, data de fim
(igual à de início para um dia), horário de início e fim opcionais (vazio = dia inteiro), motivo
obrigatório. A importação de feriados nacionais continua e cria fechamentos de dia inteiro.
*Decisão minha:* como agora importar desmarca alunas, a importação mostra a lista de feriados que
vai criar, com a prévia de quantas alunas/aulas cada um desmarca, deixa desmarcar os que não vão
fechar e só cria após confirmar; datas já cobertas por algum fechamento são puladas. Isso evita que
reimportar recrie sem aviso um feriado que foi reaberto de propósito. A lista
mostra os fechamentos futuros com o número de aulas/alunas afetadas e permite apagar (reabrir). Antes
de salvar, mostrar uma prévia: "Vai desmarcar N alunas em M aulas" — *decisão minha*, porque a ação
mexe em muita gente de uma vez.

**Quais aulas são afetadas.** Aula (recorrente ou de data específica, ativa naquela data) cuja data
está no período e, se houver faixa de horas, cujo horário **se sobrepõe** à faixa (início da aula
antes do fim da faixa e fim da aula — `horario + duracao_minutos` — depois do início da faixa).
*Decisão minha:* sobreposição, e não "começa dentro da faixa", para não deixar meia aula acontecendo.
A faixa de horas vale para todos os dias do período.

**O que acontece ao salvar** (só para aulas que ainda não começaram):
- presenças `agendado` dessas aulas → `cancelado`, `cancelado_em = now()`, motivo do fechamento;
- alunas com turma fixa (`agenda_fixa`) nessas aulas e com plano válido naquela data → é criada a
  presença `cancelado` com o motivo do fechamento (se ainda não houver linha para aquele dia);
- aluna com plano pausado naquele dia não ganha aula em haver (a pausa já trata isso — o cancelamento
  da pausa não vira reposição);
- presenças `presente`/`falta` não são tocadas;
- cada professor das aulas afetadas recebe **uma** notificação por fechamento (o envio para
  professores já funciona via `notificacoes_pendentes` / `processar-notificacoes`). *Decisão minha:*
  uma por fechamento, não uma por aula × dia, para não lotar o celular no recesso.

**Aula experimental de lead** (`leads.aula_id` + `leads.data_aula`) dentro do fechamento —
*decidido pelo usuário:* o fechamento **não mexe** no lead. A prévia (e a lista de fechamentos)
mostra "N aulas experimentais neste período" com o nome de cada lead, para a recepção ligar e
remarcar. Lead não ganha aula em haver.

**Quem passa a ser afetado depois de salvo.** *Decisão minha:* também fica com a aula em haver.
Entre salvar e o dia fechado, alguém pode entrar numa turma fixa (inclusive pelo "Trocar horário"),
ter o plano renovado/iniciado cobrindo o período, ou retomar uma pausa. Para essas alunas a geração
diária das fixas (`fn_gerar_presencas_fixos`), ao chegar num dia fechado, **cria a presença
`cancelado` com o motivo do fechamento** em vez de só pular — mesma regra de quem já estava lá. O
aviso no app é lido a partir dessas presenças canceladas, então aparece para elas também (com menos
antecedência, a partir da véspera). Agendar avulso numa aula fechada continua impossível.

**Reposição que cai no fechamento.** *Decisão minha:* mantém o comportamento atual. Se a aula
desmarcada era ela mesma uma reposição (`reposicao_de_id` preenchido), o cancelamento vira a nova
aula em haver, com a validade do plano da nova data; reabrir volta ela para `agendado`.

**Regras que passam a olhar o fechamento** (hoje olham `feriados` por dia inteiro, todas precisam
considerar período e faixa de horas):
- geração diária das fixas (`fn_gerar_presencas_fixos`) cria a presença cancelada em aula fechada
  (ver acima) e nunca duplica a que já foi criada ao salvar;
- agendamento pela aluna (listagem de aulas disponíveis e confirmação) e pelo admin
  ("Agendar na Turma") não permite aula fechada;
- limite semanal e contagens de frequência continuam consistentes (cancelado não conta como aula
  feita; a aula em haver aparece como reposição pendente);
- a grade mostra o fechamento: dia inteiro como hoje; faixa de horas como bloco no horário; criar aula
  nova dentro de um fechamento é bloqueado como hoje acontece com o dia bloqueado.

**Aviso no app da aluna.** Na `AreaAluno`, enquanto houver fechamento futuro (ou em andamento) que
afetou a aluna: "O estúdio estará fechado de 20/12 a 10/01 (Recesso). Suas aulas de 23/12 e 30/12
ficaram em haver." Some quando o fechamento termina.

**Permissão.** Só admin cria e apaga fechamentos. A lógica de desmarcar/remarcar roda no servidor
(função no banco), não no navegador, para não ficar pela metade.

### Fora do escopo
- Notificação no celular da aluna. Hoje nenhuma aluna tem cadastro de notificação (0 de 124 em
  produção; só professores têm Web Push). Já registrado no Linear como ILU-88 (lembretes de aula para
  alunas nunca são enviados); resolver aquela issue dá a base para avisar o fechamento por push.
- Fechar só um espaço (só Dança, só Funcional) ou só um professor.
- Editar um fechamento: apaga e cria de novo.
- Mudar a regra de validade da reposição.

### O que não pode acontecer (anti-objetivos)
- Mexer em aula que já aconteceu ou em presença já marcada como presente/falta.
- Aluna perder aula em haver sem ver o aviso.
- Reabrir um fechamento e remarcar alguém numa aula que outro fechamento ainda cobre, ou "desfazer"
  um cancelamento que já foi usado como reposição.
- Aplicar em produção sem testar no staging.

### Restrições
- Mudanças de banco como migrations versionadas em `supabase/migrations/` com a "down"
  correspondente; testar antes/depois/down no staging (`mytmreoqysbxisszludl`) antes de produção; o
  push para produção só com confirmação do usuário (há dados reais). Ver `docs/DEPLOY.md`.
- O merge do PR publica o frontend em produção: a migration precisa estar em produção antes do merge
  (abrir o PR como rascunho até lá).
- O tratamento dos feriados futuros já cadastrados (regra 7) é uma escrita em produção: avisar e
  confirmar com o usuário antes, mostrando quantas alunas/aulas serão afetadas.
- Feriados hoje são lidos em vários lugares (migrations `ilu78_agendamento_aluno`,
  `ilu127_agendamento_por_plano`, `ilu127_gestao_por_plano`, `ilu127_f2_leitura_sem_copia`; front em
  `calendarioParser.js`, `useEventosCalendario.js`, `useAgendamento.js`, `agendaAluno.js`,
  `AbaAgendarAulas.jsx`, `ConfiguracoesFeriados.jsx`). Nenhum pode ficar olhando só o dia inteiro.

### Fica para o construtor
- Modelo de dados (evoluir `feriados` ou criar tabela de fechamentos e migrar os feriados), desde que
  a importação de feriados nacionais continue funcionando sem duplicar.
- Como marcar quais cancelamentos vieram de qual fechamento (para reabrir corretamente).
- Texto exato do motivo, do aviso e da notificação.
- Como os feriados futuros existentes são processados na publicação.
