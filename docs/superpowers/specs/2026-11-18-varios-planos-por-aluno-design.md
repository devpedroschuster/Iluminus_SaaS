# Vários planos por aluno — design

- **Data:** 2026-11-18
- **Status:** aprovado pelo usuário em 2026-11-18.
- **Issue Linear:** ILU-127 (mãe); entrega 1 em ILU-128.

## 1. Por quê

Alguns alunos fecham planos separados: por exemplo, um plano de Treinamento Físico e outro de Dança. Cada plano tem preço, início, fim, vencimento, forma de pagamento (recorrente ou à vista) e cobranças próprios. Hoje o sistema só comporta um plano por aluno, porque o plano mora no cadastro (`alunos.plano_id`, `data_inicio_plano`, `data_fim_plano`, `plano_pausado_desde`, `modalidades_selecionadas`). Agendamento, bloqueio por vencimento, limite semanal, pausa, presenças fixas, renovação, repasses e cerca de 20 telas e serviços leem esses campos.

O caso já existe em produção (leitura de 2026-11-18). O **aluno 102** tem "Dança Livre Semestral" (plano 21, ciclo ativo até 19/04/2027) e "2x Treino Mensal" (plano 24, ciclo `agendado` desde 17/11, cobrança 710 de R$ 250 paga):

- o cadastro mostra só a Dança, e as modalidades selecionadas são só de dança;
- a cobrança do Treino não tem modalidade, então na apuração de repasses ela cobre qualquer modalidade selecionada, ou seja, as de dança. O professor de Treinamento Físico fica sem comissão;
- renovar qualquer um dos dois planos encerraria o outro: `renovar_plano_aluno` finaliza **todos** os ciclos `ativo`/`agendado` do aluno.

Os combos (ex.: "Combo 2 Danças + 2x Funcional") **continuam sendo um plano só**. Este design é para quando os planos são contratados separadamente.

Junto vem uma mudança na regra de comissão, decidida na mesma conversa (seção 3.1). Ela não depende dos vários planos e é entregue antes.

**Sucesso:**

- A recepção cadastra um segundo (terceiro…) plano para o aluno. Cada um tem renovação, pausa, vencimento e cobranças próprios, e mexer em um não afeta o outro.
- Na aba Modalidades, cada modalidade do aluno diz a qual plano pertence.
- No app, o aluno agenda cada aula pelo plano da modalidade dela. O limite semanal, o bloqueio de 5 dias após o vencimento e a pausa valem só para esse plano.
- Cada professor recebe a comissão da modalidade dele, coberta pelo pagamento do plano certo.
- Para os alunos com um plano só (todos, hoje, exceto o 102), nada muda de comportamento, a não ser o valor da comissão quando é combo de treino com dança (seção 3.1).

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**

1. O plano do aluno vira um registro próprio ("plano do aluno"). Um aluno pode ter vários ao mesmo tempo, inclusive da mesma área.
2. Cada modalidade do aluno é ligada a exatamente um plano do aluno.
3. Agendamento, pausa, renovação, cobranças e repasses passam a funcionar por plano do aluno.
4. Nova regra de valor da comissão regular (seção 3.1), daqui para frente.

**Não-objetivos**

- Mudar combos, preços ou o cadastro de planos (`planos`).
- Remover já os campos de plano do cadastro do aluno. Eles ficam como cópia automática do plano principal até todas as telas migrarem; a remoção é outra entrega.
- Mudar as áreas das modalidades. Mat Pilates e Yoga continuam na área "Dança", e só a área "Funcional" (Treinamento Físico) não conta como dança.
- Recalcular comissões já lançadas.

**Anti-objetivos (seria falha mesmo funcionando)**

- Renovar, pausar ou deixar vencer um plano bloquear ou alterar aulas, cobranças ou comissões de outro plano do mesmo aluno.
- Um pagamento cobrir modalidades de outro plano do aluno.
- Comissão em dobro ou escrita em mês já fechado.
- Alunos com um plano só verem qualquer diferença no app ou no agendamento.
- Mudar qualquer comissão já gravada.
- Bloquear, esconder ou desligar automaticamente um plano só porque passou do fim, sem a gestão ter clicado em "Encerrar plano".

## 3. Regras de negócio (decididas com o usuário)

### 3.1 Valor da comissão regular

- **R$ 70 (`valor_multi_modalidade`) por modalidade só quando o aluno tem duas ou mais modalidades distintas de dança** no mês. Em qualquer outro caso, **R$ 100 (`valor_1_modalidade`)** por modalidade.
- **É dança** toda modalidade da área "Dança", incluindo Mat Pilates e Yoga. Só "Treinamento Físico" (área "Funcional") não é.
- A conta é **pelo aluno, somando todos os planos dele**: Charme num plano e FitDance em outro dá R$ 70 + R$ 70.
- Exemplos:

  | Aluno tem (cobertas no mês, com professor) | Comissão |
  |---|---|
  | Charme | 100 |
  | Charme + Treinamento Físico (combo ou dois planos) | 100 + 100 |
  | Charme + FitDance (mesmo plano ou planos separados) | 70 + 70 |
  | Charme + FitDance + Treinamento Físico | 70 + 70 + 100 |
  | Treinamento Físico | 100 |

- **Vale daqui para frente**, a partir do mês seguinte ao deploy (6.3). O que já foi lançado fica como está. Hoje treino + dança paga R$ 70 cada: são 7 alunos ativos nesse caso, quase todos em combos, e eles passam a pagar R$ 100 cada.
- Plano livre não muda: continua `planos.preco × plano_livre_pct_prof`, dividido entre as modalidades frequentadas.

### 3.2 Vários planos

- Um aluno pode ter vários planos ativos ao mesmo tempo, **inclusive da mesma área** (ex.: dois planos de Dança).
- A ligação entre modalidade e plano é feita na **aba Modalidades** do perfil do aluno: cada modalidade (com as vezes por semana) aponta para um plano do aluno.
- **Uma modalidade fica ligada a um plano só** do aluno. Se pudesse estar em dois, não haveria como saber de qual plano descontar a aula. *(Proposta minha, aceita na conversa.)*
- **Agendamento:** a aula usa o plano ligado à modalidade dela. O limite semanal, o bloqueio por vencimento (5 dias), "plano não iniciado" e a pausa valem só para esse plano.
- **Mensalidades:** cada plano tem cobranças, vencimentos e forma de pagamento próprios. Renovar um plano não encerra os outros.
- **Pausa:** pausar é por plano. As regras da ILU-114 (retomada manual, dias devolvidos, cobrança dentro da pausa removida, vaga liberada, renovação bloqueada) valem dentro daquele plano.
- **Combo** continua sendo um plano só, com modalidades das duas áreas ligadas a ele.
- **Encerrar plano:** só quando a gestão clica. O plano vale até o fim do período pago e só depois sai dos avisos e libera modalidades e horários. Um plano que apenas passa do fim, sem o clique, não é bloqueado nem tirado de lugar nenhum (6.2).
- **Bloqueio por vencimento:** nenhum bloqueio novo. A regra que já existe no app do aluno (ILU-78: agendar pelo app bloqueia a partir de 5 dias após o fim) continua igual, só que por plano. A gestão continua podendo agendar aluno em atraso. *(Leitura minha da ressalva do usuário; confirmar na aprovação.)*
- **Alunos atuais:** cada um vira um aluno com um plano, com todas as modalidades ligadas a ele.
- **Plano livre:** cobre as modalidades ligadas a ele. As modalidades ligadas a outro plano do aluno seguem a regra do plano delas (seção 6.3).

## 4. Abordagens

- **A. "Plano do aluno" como registro próprio, migrando aos poucos — escolhida.** Uma tabela nova com um registro por plano contratado. Ciclos, cobranças, pausas e modalidades do aluno apontam para ela. Os campos antigos do cadastro viram cópia automática do plano principal. Os caminhos críticos (agendamento, renovação, pausa, cobranças, repasses, perfil, lista de alunos, avisos de vencimento) migram primeiro, e as telas que só exibem o plano migram depois. *Por quê:* produção com dados reais e deploy do frontend no merge; muda menos de uma vez.
- **B. O mesmo modelo, trocando tudo de uma vez.** Remove os campos do cadastro e reescreve tudo num único PR. Descartada: PR enorme, difícil de testar no staging e arriscado de pôr no ar.
- **C. Duplicar o cadastro do aluno, um por plano.** Descartada: o aluno tem um login só, e presença, histórico e app ficariam divididos.

## 5. Modelo de dados

### 5.1 `planos_aluno` (nova)

Um registro por plano contratado. Ele persiste entre renovações: renovar cria um novo ciclo em `historico_planos` dentro do mesmo registro, podendo trocar o plano (ex.: 2x Dança → 3x Dança).

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `aluno_id` | bigint FK `alunos` ON DELETE CASCADE | |
| `plano_id` | int FK `planos` | plano do ciclo vigente (o que hoje é `alunos.plano_id`) |
| `data_inicio` | date | o que hoje é `alunos.data_inicio_plano`, inclusive a regra ILU-108 (`avancar_inicio_plano`) |
| `data_fim` | date | o que hoje é `alunos.data_fim_plano` |
| `pausado_desde` | date | o que hoje é `alunos.plano_pausado_desde` |
| `encerrado_em` | date null | preenchido quando a recepção encerra o plano (o aluno deixou só aquele plano) |
| `created_at` | timestamptz | |

O nome da tabela é sugestão; o construtor pode escolher outro.

### 5.2 Ligações

- `historico_planos.plano_aluno_id` uuid FK, `NOT NULL` depois do preenchimento. Cada ciclo pertence a um plano do aluno.
- `mensalidades.plano_aluno_id` uuid FK, nulo. Preenchido nas cobranças `regular`/`plano_livre` de aluno. Avulsa, experimental e cobrança de lead ficam nulas.
- `pausas_plano.plano_aluno_id` uuid FK.
- **`alunos_modalidades` (nova):** `aluno_id`, `modalidade_id`, `vezes` int ≥ 1 e `plano_aluno_id` (FK, NOT NULL), com `UNIQUE (aluno_id, modalidade_id)`, que é a regra "uma modalidade, um plano". Substitui o array `alunos.modalidades_selecionadas`, em que a repetição significa vezes por semana.

### 5.3 Cópia no cadastro (transição)

- `alunos.plano_id`, `data_inicio_plano`, `data_fim_plano` e `plano_pausado_desde` passam a ser **cópia do plano principal**, mantida por trigger em `planos_aluno`. **Plano principal**, por decisão minha: o plano não encerrado mais antigo (`created_at`). Sem nenhum, os campos ficam nulos.
- `alunos.modalidades_selecionadas` passa a ser **cópia de `alunos_modalidades`**, com a modalidade repetida `vezes` vezes, como hoje.
- **Quem escreve, e quando.** Hoje, além das funções do banco, o frontend grava direto: o NovoAluno insere em `historico_planos` e `mensalidades` e grava `plano_id`/`modalidades_selecionadas`, e a aba Modalidades grava `modalidades_selecionadas`. O frontend novo só chega na entrega 4, então as entregas 2 e 3 não podem quebrar a tela atual. *Decisão minha:*
  - **Entregas 2 e 3, sincronização no sentido contrário** (temporária):
    - um gatilho `BEFORE INSERT` em `historico_planos` e em `mensalidades` (`regular`/`plano_livre` de aluno) preenche `plano_aluno_id` quando ele vem nulo. Usa o único plano do aluno; se não houver nenhum, cria um com os dados do insert; com mais de um, usa o principal;
    - um gatilho em `alunos`, quando `modalidades_selecionadas` muda por fora, recria `alunos_modalidades` do aluno ligando tudo ao plano principal. Isso só acontece com aluno de um plano só, porque até a entrega 4 nenhuma tela cria o segundo plano, exceto o aluno 102 (5.4);
    - as funções do banco (`renovar_plano_aluno`, `pausar_plano_aluno`, `retomar_plano_aluno`, `avancar_inicio_plano`) passam a gravar nas tabelas novas na entrega 3, e a cópia em `alunos` é refeita pelo gatilho de 5.3.
  - **Entrega 4:** NovoAluno, a aba Modalidades e a conversão de lead/experimental passam a gravar só nas tabelas novas. A sincronização no sentido contrário sai na mesma entrega, depois do deploy do frontend.
  - O construtor fecha a lista de escritores com um grep de escritas em `alunos` nesses campos. *Por quê:* com duas fontes gravando sem regra, a cópia diverge.
- A proteção de campos de admin (ILU-75) passa a cobrir as tabelas novas: o aluno só lê os próprios registros e não escreve neles.

### 5.4 Preenchimento dos dados atuais (backfill)

Na mesma migration que cria as tabelas:

1. Para cada aluno com `plano_id` ou com algum ciclo em `historico_planos`, cria um `planos_aluno` com os campos atuais do cadastro.
2. Liga a ele todos os ciclos, pausas e cobranças `regular`/`plano_livre` desse aluno.
3. Converte `modalidades_selecionadas` em `alunos_modalidades`, contando as repetições como `vezes`, ligadas a esse plano.
4. Alunos com modalidades mas sem plano nem ciclo: o construtor decide (ver seção 10). Como `plano_aluno_id` é NOT NULL, eles precisam de um tratamento explícito.

**Ciclos em aberto de planos diferentes** (*decisão minha*): se o aluno tem mais de um ciclo `ativo`/`agendado` com planos diferentes, o backfill cria um plano do aluno para cada um. Cada cobrança vai para o plano do aluno que tem o mesmo `plano_id`. As modalidades vão para o plano do cadastro (`alunos.plano_id`). Hoje isso só acontece com o **aluno 102**: ele fica com "Dança Livre Semestral" (ciclo do plano 21) e "2x Treino Mensal" (ciclo do plano 24, cobrança 710), sem nenhuma correção manual em SQL e sem tela nova para mover ciclo ou cobrança. Depois da entrega 4, a recepção só inclui Treinamento Físico na aba Modalidades dele, ligado ao plano de Treino, com as vezes por semana confirmadas com o aluno. Esse ciclo de Treino segue `agendado` mesmo com o início já passado. O construtor deve conferir se `avancar_inicio_plano` o ativa.

## 6. Comportamento

### 6.1 Agendamento (`_avaliar_agendamento`, `listar_aulas_aluno`, `agendar_aula`, `_fixo_valido`, `_uso_semanal`, `verificar_disponibilidade_v2`, `fn_gerar_presencas_fixos`, `fn_resumo_frequencia_aluno`)

- O plano da aula é o `planos_aluno` ligado a `alunos_modalidades` para a modalidade da aula. Sem ligação: `fora_matricula`, como hoje para modalidade não selecionada.
- `sem_plano`, `plano_pausado`, `plano_nao_iniciado` e `plano_vencido` passam a ler as datas e a pausa **desse** plano. A mensagem cita o nome do plano quando o aluno tem mais de um ("Seu plano 2x Treino Mensal venceu em 17/12…").
- **Limite semanal:** a regra vem de `regras_acesso` do plano do ciclo vigente, pela área da aula, como hoje. O uso conta só as aulas das modalidades ligadas **ao mesmo plano do aluno** naquela área. Assim, dois planos de Dança têm limites independentes. Com um plano só, o resultado é idêntico ao de hoje.
- **Pausa:** `_em_pausa`/`pausas_plano` passam a ser por plano. A vaga fixa liberada na pausa é só a das modalidades daquele plano.
- **Presenças fixas** (`fn_gerar_presencas_fixos`): o fim que corta a geração é o do plano da modalidade da turma, não `alunos.data_fim_plano`.
- **App do aluno** (`listar_aulas_aluno` → `AreaAluno`): devolve a lista de planos (nome, fim, `bloqueia_a_partir_de`, pausado desde) e, em cada aula, o plano dela. Para não quebrar o app em produção entre o deploy do banco e o do frontend, continua devolvendo também as chaves antigas com o plano principal.

### 6.2 Renovação, pausa e cobranças

- `renovar_plano_aluno` ganha `p_plano_aluno_id` (default NULL = cria um novo plano do aluno, usado em "Adicionar outro plano" e no primeiro plano). Tudo que hoje filtra por aluno passa a filtrar por esse plano: finalizar ciclos abertos, o bloqueio por pausa, o `DELETE` das cobranças cobertas pelo ciclo à vista e a busca da cobrança existente no vencimento. A cobrança criada recebe o `plano_aluno_id`. Com o parâmetro nulo e o aluno tendo exatamente um plano, a função usa esse plano, para manter o frontend antigo funcionando até a entrega do novo.
- `pausar_plano_aluno`/`retomar_plano_aluno`: por plano do aluno, com a mesma regra de fallback.
- `vincular_cobranca_integral` e `ligar_pagamento_ao_ciclo`: procuram cobranças só do mesmo plano do aluno.
- **Pagamento manual** (`ModalAdicionarPagamentoManual`): na cobrança `regular`/`plano_livre` de um aluno com mais de um plano, a recepção escolhe o plano do aluno. Com um plano só, ele é escolhido sozinho.
- **Encerrar um plano** (o aluno sai só da dança, por exemplo). É uma ação nova no perfil; hoje existe só a inativação do aluno inteiro. Regras decididas com o usuário:
  - **Só acontece quando a gestão clica em "Encerrar plano".** Um plano que apenas passa do fim, sem esse clique, continua exatamente como hoje: não sai de nenhuma lista ou aviso, não perde modalidades nem horários fixos, e não ganha nenhum bloqueio novo. O espaço é pequeno e às vezes agenda aluno com plano ou pagamento em atraso, e isso deve continuar possível.
  - Encerrar significa **"não vai renovar"**. O plano vale até o `data_fim` do ciclo já pago: o aluno continua agendando e a comissão desses meses segue normal. A ação grava `encerrado_em` (a data do fim) e remove as cobranças em aberto daquele plano com vencimento depois do fim.
  - **Depois do fim de um plano encerrado:** ele sai dos avisos de vencimento e da situação do aluno na lista. As linhas de `alunos_modalidades` ligadas a ele são desligadas, e os horários fixos (`agenda_fixa`) dessas modalidades são removidos. *Decisão minha:* esses efeitos rodam no mesmo agendamento diário de `avancar_inicio_plano`, e nunca antes do fim. Assim, a apuração dos meses pagos encontra os vínculos.
  - Cortar no meio de um período pago (com devolução, por exemplo) continua sendo um acerto manual, como hoje.
  - *Decisões minhas:* dá para encerrar o último plano do aluno (sem inativar o aluno; inativar continua sendo outra ação) e dá para desfazer o encerramento enquanto o fim não chegou.

### 6.3 Repasses (`_apurar_repasses`)

- Cada fonte de cobertura (cobrança recorrente paga, ou aniversário de ciclo à vista) carrega o `plano_aluno_id`: o da cobrança, ou o do ciclo.
- **Cobertura:** cada modalidade do aluno é coberta pela fonte **do plano ao qual está ligada**. Não usa mais "qualquer fonte cobre qualquer modalidade". Uma cobrança com `modalidade_id` continua cobrindo só aquela modalidade.
- **Estado por plano, não por aluno.** Hoje, se qualquer fonte do mês é de plano livre, o aluno inteiro vira "plano_livre". Agora:
  - o plano livre usa a regra atual de plano livre (presenças do mês, preço do plano × pct, divisão igual). Valem as presenças em todas as modalidades **exceto as ligadas a outro plano do aluno**. Com um plano só, é idêntico a hoje;
  - um plano regular usa a regra regular para as modalidades ligadas a ele;
  - bolsista e inativo continuam valendo para o aluno inteiro; pausado e sem cobertura passam a ser por plano.
- **Valor regular (3.1):** conta as modalidades distintas da área "Dança" cobertas no mês e com professor, **somando todos os planos regulares do aluno**. Com 2 ou mais, as de dança levam `valor_multi_modalidade`; senão, `valor_1_modalidade`. Treinamento Físico leva sempre `valor_1_modalidade`. Modalidades de um plano livre ficam fora dessa conta, porque seguem a divisão do plano livre.
- **Daqui para frente:** nova coluna em `configuracoes_repasse` (ex.: `regra_danca_desde date`), preenchida com o 1º dia do **mês seguinte** ao deploy da entrega 1 (decisão do usuário). Exemplo: deploy em novembro, vale a partir de dezembro de 2026. Assim, o mês corrente não fica com R$ 70 e R$ 100 misturados para o mesmo aluno. Competências anteriores usam a regra antiga. Como a apuração só insere e nunca altera o que existe, nada já gravado muda.
- `_mes_da_comissao`, uq de competência, fechamento e corte não mudam.
- O construtor deve confirmar se as Edge Functions `gerar-repasses`/`gerar-repasses-mensais`/`preview-repasses-mensais` ainda são chamadas depois da ILU-122. Se forem, a regra de cobertura por plano e a do valor precisam valer nelas também. Se não forem, elas ficam de fora.

### 6.4 Telas

**Primeira entrega de frontend:**

- **Perfil do aluno:**
  - uma área "Planos" lista cada plano do aluno (nome, ciclo vigente, fim, situação, forma de pagamento), com Renovar, Pausar/Retomar e Encerrar **por plano**, e um botão "Adicionar outro plano", que abre o modal de renovação sem plano do aluno;
  - aba Modalidades: cada linha com o seletor de plano. Com um plano só, ele é escolhido sozinho e o seletor fica oculto. Não salva modalidade sem plano;
  - aba Financeiro: as cobranças mostram de qual plano são.
- **NovoAluno e conversão de lead/experimental:** criam o primeiro plano do aluno pelo caminho novo.
- **Lista de alunos, Dashboard e notificações de vencimento** (`Alunos`, `dashboardService`, `useNotificacoes`, `utils`): mostram a situação por plano. O aluno aparece como vencido ou vencendo se qualquer plano dele estiver assim, com o nome do plano. Plano encerrado pela gestão sai dessa conta depois do fim; os demais continuam aparecendo como hoje.
- **App do aluno:** mostra cada plano com o próprio vencimento e aviso de bloqueio.

**Entrega posterior:** Presença, ProfessorAlunos, calendarioParser, gradeService, modalidadeService e validation passam a ler das tabelas novas. Depois, outra entrega remove os campos copiados.

## 7. Entregas e ordem

Regra do projeto: migration e functions vão ao ar antes do merge do frontend (o merge publica o frontend em produção), e tudo é testado no staging antes, incluindo a down.

1. **Regra da comissão de dança.** Migration com a nova `_apurar_repasses` e a coluna de config, mais o teste SQL. Independente do resto.
2. **Schema + backfill + cópias.** Tabelas novas, colunas de ligação, preenchimento, triggers de cópia e a sincronização no sentido contrário (5.3). Nenhuma mudança de comportamento: a tela atual de cadastro e a aba Modalidades continuam funcionando. Teste SQL de invariantes: todo ciclo, pausa e cobrança regular de aluno tem plano do aluno; as cópias batem com o plano principal; `alunos_modalidades` reproduz o array.
3. **Banco por plano.** Agendamento, pausa, renovação, cobranças e repasses (seções 6.1 a 6.3), com fallback para o frontend antigo. Teste SQL com um aluno de dois planos da mesma área e outro de dança + treino, cobrindo vencimento, pausa e limite de um sem afetar o outro, além da cobertura e do valor da comissão.
4. **Frontend primeira leva** (6.4), com testes Vitest das partes de lógica. Verificação no staging com as contas de teste.
5. **Acerto do aluno 102** em produção: o backfill já separa os dois planos (5.4), e a recepção liga o Treinamento Físico na aba Modalidades.
6. **Frontend segunda leva** e, mais tarde, a remoção das cópias. São issues próprias.

## 8. Testes e verificação

- Teste SQL em `scripts/sql-tests/` para as entregas 1, 2 e 3, rodado no staging antes e depois de cada migration e com a down.
- A down de cada migration fica em `supabase/migrations-down/`.
- Vitest para a lógica nova do frontend (situação por plano, seletor de plano nas modalidades).
- Verificação manual no staging: criar um aluno com dois planos, agendar pelo app, deixar um vencer, pausar o outro, renovar cada um, receber os pagamentos e apurar repasses.

## 9. Riscos

- **Cópia divergente** se sobrar algum caminho gravando direto nos campos de `alunos`. Mitigação: grep na entrega 3 e o teste de invariantes rodando também depois da entrega 4.
- **App em produção** entre o deploy do banco e o do frontend. Mitigação: as chaves antigas em `listar_aulas_aluno` e os fallbacks com um plano só.
- **Valor de comissão** muda para combos de treino + dança. Esperado e decidido; registrar no PR.

## 10. Deixado para o construtor

- Os nomes de tabelas e colunas.
- O tratamento, no backfill, de aluno com modalidades mas sem plano nem ciclo: medir quantos são e propor.
- Se as Edge Functions de repasse antigas ainda são usadas (6.3).
- A lista completa de escritores dos campos copiados (5.3).
- O desenho visual da área "Planos" no perfil, seguindo os componentes existentes.
