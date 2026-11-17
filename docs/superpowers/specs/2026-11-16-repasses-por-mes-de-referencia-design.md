# Repasses por mês de referência — design

- **Data:** 2026-11-16
- **Status:** rascunho, aguardando aprovação do usuário.
- **Issue Linear:** a criar no time Iluminus, junto com o plano.

## 1. Por quê

Alguns alunos não aparecem no registro mensal de repasses (tela Comissões). Uma revisão do código e dos dados de produção, feita só com leitura em 2026-11-16, achou três causas que se somam:

1. **A geração do lote mensal falha sempre desde julho.** `gerar-repasses-mensais` grava com `upsert(..., { onConflict: 'aluno_id,modalidade,tipo_aula,data_referencia', ignoreDuplicates: true })`. O índice `uq_repasse_lote_mensal` é parcial (`WHERE mensalidade_id IS NULL`), e o Postgres não usa índice parcial num `ON CONFLICT` sem a mesma condição. Resultado: `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`. O único lote gravado em produção é de 06/06/2026. A tela mostra só "Edge Function returned a non-2xx status code".
2. **O plano pago à vista só gera comissão no mês do pagamento.** A comissão nasce do evento de pagamento (`gerar-repasses`): um pagamento vira um mês de comissão. O lote, mesmo funcionando, exige uma cobrança `regular` paga com vencimento no mês, e o ciclo à vista não tem essa cobrança, por definição. Em outubro e novembro, pelo menos 14 alunos/mês ficaram sem comissão (cerca de R$ 1.800/mês). Entre julho e setembro, de 16 a 29 alunos/mês. A estimativa é de cerca de R$ 11,6 mil entre julho e novembro.
3. **O plano livre nunca entra no lote.** O filtro de quem está em dia aceita só `tipo_aula = 'regular'`, e a cobrança do plano livre é `plano_livre`. No pagamento, a divisão usa só as presenças até aquele instante: quem paga no início do mês fica com zero, e nada recalcula depois.

A mesma revisão achou falhas que o novo modelo também resolve:

- **O mês da comissão é o do pagamento, não o da mensalidade.** O aluno #114 pagou em 03/11 a mensalidade que venceu em 31/10: outubro ficou vazio, e o repasse foi para novembro.
- **Comissão em dobro, ou para o professor errado.** Cada pagamento gera repasse para todas as `modalidades_selecionadas` do aluno, seja qual for a cobrança. Há 12 pares duplicados: o aluno com dois planos paga os dois professores duas vezes; o complemento de troca de plano gera o repasse inteiro de novo.
- **`modalidade_id` na cobrança vira comissão de 100% do valor pago** (`gerar-repasses/index.ts`, ramo regular). Ainda não há caso em produção, mas o pagamento manual já deixa escolher a modalidade.
- **A comparação "já tem repasse?" é feita pelo nome da modalidade**, e três modalidades já foram renomeadas.
- **Erros silenciosos:**
  - o pagamento manual descarta o resultado da geração de repasse (`financeiroService.adicionarPagamentoManual`), então os avisos somem;
  - `comissoesService.buscarDetalhes` ignora o erro da consulta de fechamento;
  - a reconciliação do lote só cobre avulsa e experimental.

**Sucesso:**

- Todo aluno coberto por plano pago aparece no registro de cada mês coberto, com a comissão do professor daquele mês, sem ninguém precisar lembrar de clicar.
- Quem não aparece tem um motivo visível na tela: bolsista, pausa, mês não pago, modalidade sem professor, plano livre sem presença.
- Nenhuma comissão em dobro, e nenhuma escrita em mês já fechado.
- A partir de novembro de 2026, o registro do sistema fica completo e pode substituir o controle paralelo que a gestão mantém hoje por causa desses erros.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**

1. A comissão de mensalidade (regular e plano livre) passa a nascer de **aluno × modalidade × mês de referência**, a partir de uma regra única de cobertura (seção 3), aplicada por uma função no banco.
2. O ciclo à vista gera comissão em **cada mês** do ciclo.
3. O plano livre é apurado com o mês inteiro de presenças.
4. Apuração automática todo dia, além do pagamento recebido e do botão manual.
5. A tela Comissões mostra quem ficou sem comissão no mês e por quê.
6. Novembro de 2026 completo na primeira apuração, com lista conferida pela gestão antes de gravar. Os meses anteriores ficam como estão (3.7).

**Não-objetivos**

- **Não criar nenhuma mensalidade.** Palavras do usuário: no ciclo trimestral à vista de R$ 300, "nos próximos meses precisamos contar esse aluno como pago, gerar a comissão normalmente para o professor, mas não criar uma outra entrada nas mensalidades, pois não entrou nenhum valor naquele mês". "Contar como pago" vale **para a comissão**. Receita, Financeiro, DRE de receita e status do aluno não mudam.
- Não mudar a regra de aula avulsa nem de experimental: continuam nascendo do pagamento, em `gerar-repasses`.
- Não mudar os valores configurados (R$ 100 / R$ 70 / 50%), nem os percentuais de avulsa e experimental.
- Não mexer nas 86 cobranças automáticas do dia 10 que seguem em aberto. A ILU-116 já deu à gestão a aba Financeiro para tratá-las. A nova regra simplesmente não depende delas para os meses de ciclo à vista.
- Não refazer comissões de meses já fechados (`fechamento_comissoes`), nem recalcular o `valor_total` de um fechamento.

**Anti-objetivos (seria fracasso mesmo "funcionando")**

- Uma mensalidade, ou qualquer entrada de dinheiro, aparecer num mês em que não entrou valor.
- Comissão lançada para um mês que ainda não começou.
- Comissão nova somada a julho, agosto, setembro ou outubro de 2026, meses já acertados com os professores fora do sistema.
- A apuração automática recriar uma comissão que a gestão removeu de propósito.
- Comissão gravada, alterada ou apagada num mês já fechado para o professor.
- Duas comissões para o mesmo aluno, modalidade e mês de referência.
- Aluno coberto sumir do registro sem motivo visível.

## 3. Regras de negócio

Decididas com o usuário em 2026-11-16, salvo onde está marcado **(decisão minha)**.

### 3.1 Unidade

Uma comissão de mensalidade é **um aluno, uma modalidade, um mês de referência** (o mês a que ela se refere, chamado aqui de competência). Cada modalidade conta **uma vez por mês**, não importa quantas cobranças ou planos o aluno tenha.

### 3.2 Quando um mês está coberto

Um mês M do aluno está coberto quando qualquer uma das duas condições vale:

- **Recorrente:** existe uma mensalidade `regular` ou `plano_livre` do aluno, `status = 'pago'`, com `data_vencimento` dentro de M. É a regra da ILU-13 e a mesma que `_comissoes_elegiveis` já usa. Mensalidade em aberto não cobre nada até ser paga.
- **À vista:** o aluno tem um ciclo em `historico_planos` com `forma_recebimento = 'a_vista'` cuja cobrança integral está paga. Esse ciclo cobre os meses que contêm os "aniversários" do ciclo: `data_inicio + k meses`, para k = 0, 1, 2…, enquanto a data for `<= data_fim`. Os aniversários que caem dentro de uma pausa são pulados.
  - Exemplo: o ciclo de 04/09 a 03/03 cobre setembro a fevereiro, ou seja, seis meses.
  - Com 30 dias de pausa em novembro, a retomada estende `data_fim` em 30 dias (`retomar_plano_aluno` já faz isso). O aniversário de dezembro cai na pausa e é pulado, o de março passa a caber: continuam seis meses.
  - **(decisão minha)** "Aniversário" em vez de "todo mês que o ciclo toca", porque um ciclo de 6 meses que começa no dia 4 toca 7 meses do calendário.

Um mês nunca é coberto antes de começar: a apuração só olha meses `<=` o mês corrente em Brasília.

**(decisão minha)** Ciclos à vista com `status` `ativo` ou `finalizado` cobrem os aniversários deles. Um `agendado` passa a cobrir quando chega o mês do início dele.

Um ciclo à vista encerrado antes do fim por uma renovação (`renovar_plano_aluno` marca o anterior como `finalizado`) continua cobrindo os meses que já estavam pagos. Se o ciclo novo também cobrir o mesmo mês, o índice único garante uma comissão só.

### 3.3 Fica de fora

- **Bolsista** (`alunos.bolsista = true`): nunca gera comissão de mensalidade. **(Decisão minha:** vale também para bolsa parcial paga, caso dos alunos #27 e #28. O usuário respondeu "não recebe"; se a bolsa parcial paga deve gerar, muda só este item.)
- **Mês pausado:** coberto pelo aniversário pulado (3.2). No recorrente, a pausa já remove a cobrança do período.
- **Aluno inativo, na apuração automática.** O pagamento recebido de um mês passado gera comissão mesmo com o aluno já inativo, porque o pagamento prova o mês. **(Decisão minha:** não há data de inativação gravada, então só o mês corrente em diante olha `ativo`.)
- **Modalidade sem professor** (`modalidades.professor_id` nulo).

### 3.4 Valores

- **Regular:** R$ `valor_1_modalidade` quando o aluno tem uma modalidade com professor no mês; R$ `valor_multi_modalidade` por modalidade quando tem duas ou mais. Distintas, contando cada modalidade uma vez, como já faz o lote.
- **Plano livre:** `planos.preco` (mensal) × `plano_livre_pct_prof`, dividido por igual entre as modalidades distintas com presença `status = 'presente'` no mês inteiro. É o cálculo de hoje, com centavos distribuídos por `distribuirCentavos`. **(Decisão minha:** usa o preço mensal do plano, e não o `valor_pago`, no à vista e no recorrente, porque um pagamento à vista de 6 meses não pode virar 6 meses de comissão num mês só.) Sem presença no mês: sem comissão, com o motivo visível.
- **Mensalidade com `modalidade_id`** (pagamento manual que cobre uma modalidade só): a cobertura dela vale só para aquela modalidade, com o valor da regra (uma modalidade coberta, então `valor_1_modalidade`). Some o "valor cheio do pagamento". **(Decisão minha.)**
- O valor é calculado na hora em que a comissão é gravada. Comissão já gravada nunca é recalculada. Se o aluno ganhar uma segunda modalidade no meio do mês, a nova linha usa o valor de duas ou mais, e a antiga fica como estava.
- **(decisão minha)** O preço do plano livre vem do plano que cobre o mês: o `plano_id` do ciclo à vista ou o da cobrança paga do mês. Não vem de `alunos.plano_id`, que só guarda o plano atual.

### 3.4.1 Limites aceitos (decisão minha)

- As modalidades consideradas são as `modalidades_selecionadas` atuais do aluno, e o professor é o atual da modalidade. Não há histórico de quais eram no mês. No preenchimento retroativo, isso usa a matrícula de hoje para meses passados.
- No recorrente, o mês coberto é o do vencimento da cobrança. Exemplo: a cobrança lançada com vencimento em 26/10, quando era a de novembro (aluno #113), cobre outubro, e novembro fica sem cobertura até haver uma cobrança paga com vencimento em novembro. Isso aparece no quadro "sem comissão", com o motivo.

### 3.5 Em que mês a comissão entra (decisão do usuário: opção B)

A comissão entra no mês de referência. Se esse mês já estiver fechado para aquele professor, entra no **primeiro mês seguinte ainda não fechado para ele**, marcada "referente a mm/aaaa". Mês fechado nunca recebe escrita.

Conta como fechado:

- o mês que tem `fechamento_comissoes` para professor + mês;
- todo mês anterior ao corte (3.7), para todos os professores.

### 3.6 Quando a comissão aparece

- **Pagamento recebido** (receber cobrança, pagamento manual, renovação já recebida): na hora, para aquele aluno e para cada mês coberto por aquele pagamento que já começou. A renovação à vista recebida hoje mostra a comissão do mês corrente na hora; os meses seguintes entram quando cada um começar.
- **Todo dia, sozinho** (decisão do usuário): a apuração roda de madrugada no mês corrente e no anterior. O anterior fecha o plano livre e pega o que chegou atrasado. Ela só grava comissão. **Nunca cria cobrança.**
- **Botão "Gerar repasses do mês"** em Comissões, com a prévia de hoje: força a mesma apuração para qualquer mês a partir do corte (3.7).

### 3.7 Corte em novembro de 2026 (decisão do usuário)

Julho a outubro de 2026 já foram pagos aos professores por um controle paralelo, porque o registro do sistema não era confiável. Só agosto está fechado no sistema, e só para dois professores. Nas palavras do usuário: "esses meses retroativos já foram fechados, mas não no nosso sistema".

Então:

- **Sem preenchimento retroativo.** A apuração diária e o botão só avaliam competências a partir de **11/2026**. As linhas que já existem antes disso ficam como estão, inclusive as duplicatas.
- **Um pagamento recebido depois da entrada no ar**, para uma mensalidade com vencimento antes de 11/2026, gera comissão normalmente. Pela regra 3.5 ela entra no primeiro mês aberto, marcada "referente a mm/aaaa". **(Decisão minha:** é informação nova, que o controle paralelo não tinha como ter pago.)
- **(Decisão minha)** O corte é um valor único guardado no banco, por exemplo em `configuracoes_repasse`, e não uma data fixa espalhada pelo código.
- **(Decisão minha)** Comissões, ao mostrar um mês anterior ao corte, avisa "Mês acertado fora do sistema", e o botão "Aprovar fechamento" fica escondido nesses meses. Sem isso, um fechamento gravaria um total incompleto.

## 4. Abordagens consideradas

1. **Apuração mensal guardada no banco (escolhida pelo usuário).** Uma função SQL aplica a regra da seção 3 a um mês, ou a um aluno num mês, e grava só o que falta. Pagamento, agendamento diário, botão e preenchimento retroativo chamam a mesma função. Fechamento, Reverter/Excluir (ILU-116), tela do professor, DRE e painel continuam lendo `repasses_lancamentos`, com ajustes pequenos.
2. **Registro calculado na hora, guardado só no fechamento.** Nunca falta ninguém, mas tela do professor, DRE, painel, edição de lançamento e Reverter/Excluir leem linhas gravadas e precisariam ser refeitos. É o mais arriscado.
3. **Gerar no pagamento, mês a mês.** O pagamento à vista cria de uma vez as comissões de todos os meses do ciclo, inclusive os futuros. É a menor mudança, mas pausa, cancelamento, troca de plano e reversão teriam que apagar comissões futuras, e essa é a mesma classe de falha que causou o problema. Descartada.

O usuário perguntou se, na abordagem 1, "renovou o plano de um aluno, vai continuar já aparecendo nas comissões". Sim, para o mês corrente (3.6). Escolheu a abordagem 1 com isso.

## 5. Desenho

### 5.1 Dados

**`repasses_lancamentos`** (migration aditiva):

- `competencia date`: o primeiro dia do mês de referência. `data_referencia` continua sendo o mês em que a comissão **entra**: é o que Comissões, fechamento, DRE e painel já filtram. Os dois só diferem quando a regra 3.5 empurra a comissão para frente.
- `modalidade_id uuid` com FK para `modalidades`: a comparação passa a ser por identificador. `modalidade` (nome) continua sendo gravado para exibição e histórico.
- `mensalidade_id` passa a apontar, nas comissões novas de regular e plano livre, para a **cobrança que justificou o mês**: a do mês no recorrente, a integral no à vista. Assim o Reverter/Excluir da ILU-116 já lista essas comissões pelo vínculo que conhece (5.5). Comissões novas de mensalidade não usam mais `mensalidade_id IS NULL`, que fica restrito às linhas antigas do lote.
- Índice único novo para comissões de mensalidade: `(aluno_id, modalidade_id, competencia) WHERE tipo_aula IN ('regular','plano_livre') AND modalidade_id IS NOT NULL`. A gravação usa `INSERT ... ON CONFLICT (aluno_id, modalidade_id, competencia) WHERE <mesma condição> DO NOTHING`, com a condição explícita, que é a lição do erro 42P10.
- **(decisão minha)** As linhas que já existem não são alteradas: ficam sem `competencia` e sem `modalidade_id`. Com isso, o índice novo não colide com as duplicatas antigas. A apuração reconhece essas linhas pelo nome (5.2). Para exibição, `competencia` vazia vale o mesmo que `data_referencia`.

**`historico_planos`**: coluna nova `cobranca_integral_id bigint` com FK para `mensalidades`, `ON DELETE SET NULL`. É o vínculo explícito entre o ciclo à vista e a cobrança integral dele.

- Hoje esse vínculo só existe por convenção (mesmo aluno, mesmo plano, vencimento = início do ciclo). Em produção, só 10 dos 19 ciclos à vista ativos casam exatamente.
- Preenchem a coluna: `renovar_plano_aluno`, o cadastro (`NovoAluno.jsx`, `criarRegistrosFinanceiros`) e a edição de ciclo para à vista da ILU-70.
- Os ciclos existentes são ligados por uma correção de dados conferida (5.6).

**Comissões removidas pela gestão:** tabela pequena, por exemplo `repasses_removidos (aluno_id, modalidade_id, competencia, removido_por, removido_em)`. A apuração consulta essa tabela e não recria o que está nela.

- Quem grava: `comissoesService.deleteLancamento` (excluir comissão na tela de Comissões), quando a linha é de regular ou plano livre.
- **(Decisão minha:** uma tabela à parte, e não uma exclusão lógica na própria linha, porque todos os leitores de `repasses_lancamentos` — totais, fechamento, DRE, painel, tela do professor — teriam que aprender a ignorar linhas "removidas".)
- O Reverter/Excluir da ILU-116 não precisa gravar ali: ao reverter, a cobertura some junto com o pagamento.

### 5.2 Função de apuração

Uma função SQL `SECURITY DEFINER`, por exemplo `apurar_repasses(p_competencia date, p_aluno_id bigint DEFAULT NULL, p_simular boolean DEFAULT false)`. Ela roda para admin ou `service_role`, e para o agendamento (ver o padrão de `fn_confirmar_presencas_automaticas` / `fn_gerar_presencas_fixos`, ILU-94).

Ela devolve uma linha por aluno × modalidade avaliado, com:

- `situacao`: `gerada`, `ja_existia`, `removida_pela_gestao`, `sem_cobertura`, `bolsista`, `pausado`, `inativo`, `sem_professor`, `plano_livre_sem_presenca` ou `plano_livre_mes_em_andamento`;
- professor, valor, `competencia`, mês de entrada e a cobrança que justificou.

Comportamento:

- `p_simular = true` não grava nada. É o que alimentam a prévia do botão e o quadro "sem comissão" da tela.
- Só **insere**. Nunca atualiza nem apaga comissão existente.
- Não grava nada para competência futura, nem plano livre do mês corrente.
- Considera "já existe" uma comissão antiga sem `modalidade_id` (lote ou pagamento de antes) do mesmo aluno e mês, casando pelo nome da modalidade. Isso evita duplicar em novembro de 2026, que já tem comissões geradas pelo modelo antigo.
- Não avalia competência anterior ao corte (3.7), a não ser no caminho do pagamento recebido descrito lá.
- Roda numa transação. Duas chamadas simultâneas para o mesmo mês não duplicam, por causa do índice único.

### 5.3 Quem chama

- **Pagamento.** `gerar-repasses` continua sendo o ponto chamado pelo front (`confirmarPagamento`, `adicionarPagamentoManual`, `renovarPlano`, reconciliação).
  - Os ramos regular e plano livre passam a chamar `apurar_repasses` para o aluno e as competências cobertas por aquela cobrança que já começaram. O apaga-e-recria de hoje some desses ramos.
  - Avulsa e experimental ficam como estão.
  - A resposta continua trazendo `gerados` e `avisos`.
  - `adicionarPagamentoManual` passa a devolver os avisos à tela, em vez de descartá-los.
- **Agendamento diário:** `pg_cron` às 03:00 de Brasília (06:00 UTC), apurando o mês corrente e o anterior. **(Decisão minha:** o horário pode mudar.)
- **Botão e prévia** em Comissões: chamam a função com o mês escolhido (prévia com `p_simular`).
  - `gerar-repasses-mensais` e `preview-repasses-mensais` viram invólucros finos da função, ou saem em favor de chamada RPC direta. Decide quem constrói, desde que a autorização de admin continue.
  - A etapa 11 (reconciliação de avulsa e experimental) continua existindo em algum dos dois caminhos.

### 5.4 Telas

- **Comissões, Visão Geral:** quadro "Alunos sem comissão em {mês}", com o motivo de cada um, vindo da simulação. Bolsista e inativo podem ficar recolhidos.
- **Comissões, Detalhe e tela do professor (`ProfessorComissoes`):** quando `competencia` difere de `data_referencia`, mostra "referente a mm/aaaa".
- **Configurações de Repasse:** os textos passam a descrever o cálculo real.
  - "Valor Multi-Modalidade" é o valor **por modalidade** do aluno regular com duas ou mais, e não "mensalidade do plano livre".
  - O plano livre divide **por igual** entre as modalidades frequentadas, e não "proporcional às aulas".
- **Erros de Edge Function:** as telas que chamam as functions de repasse mostram a mensagem real do corpo da resposta (o `context` do `FunctionsHttpError`), e não "non-2xx status code".

### 5.5 Reverter e Excluir (ILU-116)

- `_comissoes_elegiveis` e `listar_comissoes_da_mensalidade` continuam funcionando pelo `mensalidade_id`.
- Para a cobrança integral de um ciclo à vista, a lista passa a trazer as comissões de todos os meses do ciclo já lançados, e cada uma diz se o mês está fechado (o aviso da ILU-116 já existe).
- O ramo "linha do lote" continua valendo para as linhas antigas.
- Ao excluir mantendo uma comissão, a ILU-116 desliga a comissão (`mensalidade_id = NULL`). Com o índice novo, isso não colide, porque a chave não inclui `mensalidade_id`.

### 5.6 Dados existentes

A ordem importa. Nada é gravado sem a lista ter sido mostrada e aprovada pelo usuário.

1. **Ligar e corrigir ciclos à vista antigos.** Listar os ciclos com pagamento integral identificável e propor, ciclo a ciclo, `forma_recebimento = 'a_vista'` e `cobranca_integral_id`.
   - Pagamento integral identificável: cobrança paga do ciclo com descrição "Pagamento integral do plano" ou valor `>=` cerca de 2 meses do preço.
   - Hoje são 21 ciclos ativos marcados como recorrentes com pagamento integral, por serem anteriores à coluna `forma_recebimento` (17/09), e 9 ciclos à vista sem vínculo exato.
2. **Conferência de novembro de 2026.** Antes de ligar o agendamento, rodar `apurar_repasses` simulando para novembro e mostrar a lista ao usuário: aluno, modalidade, professor, valor e motivo de quem fica de fora.
   - Junto vai a única duplicata antiga num mês aberto: aluno #82, novembro, duas comissões de Treinamento Físico, uma delas vinda de uma cobrança de Dança. A proposta é remover a excedente, só com aprovação. **(Decisão minha:** as duplicatas de julho a outubro ficam, porque esses meses já foram acertados fora do sistema, 3.7.)
   - Com a lista aprovada, gravar novembro e ligar o agendamento.

Não há preenchimento de julho a outubro (3.7).

### 5.7 Testes e deploy

- **Testes SQL** em `scripts/sql-tests/`, no padrão dos existentes. Cobrir:
  - à vista de 3 e de 6 meses, com e sem pausa;
  - recorrente pago, em aberto e pago atrasado com o mês fechado;
  - plano livre no mês em andamento e no mês terminado, e sem presença;
  - bolsista, inativo e modalidade sem professor;
  - duas cobranças no mesmo mês e aluno com dois planos;
  - comissão removida pela gestão não volta;
  - competência anterior ao corte: a apuração diária não grava, e o pagamento recebido depois grava no primeiro mês aberto;
  - duas apurações simultâneas não duplicam;
  - Reverter/Excluir de uma cobrança integral.
- **Vitest** nos serviços que mudam.
- Tudo primeiro no staging (`mytmreoqysbxisszludl`), com antes, depois e migration down em `supabase/migrations-down/`.
- Deploy na ordem de `docs/DEPLOY.md`: migration aditiva → Edge Function → frontend → agendamento → correções de dados e preenchimento (5.6), estes só com aprovação explícita do usuário em produção.

## 6. Deixado para quem constrói

- Os nomes exatos da função, da tabela de removidas e das colunas.
- Se as Edge Functions de lote viram invólucros ou saem.
- O formato do retorno da função.
- O visual do quadro "sem comissão", desde que mostre aluno e motivo.
- O horário do agendamento.
- O limite do "valor integral identificável" na correção de ciclos antigos: é só um critério para montar a lista, que o usuário confere.

## 7. Perguntas em aberto

Nenhuma.

- Os meses anteriores a novembro de 2026 foram respondidos pelo usuário em 3.7.
- As duplicatas antigas ficaram resolvidas por consequência disso: só a de novembro (#82) está num mês aberto e entra na conferência (5.6).
