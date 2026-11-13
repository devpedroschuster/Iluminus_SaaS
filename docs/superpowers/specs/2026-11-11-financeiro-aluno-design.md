# Aba Financeiro no perfil do aluno + fim da mensalidade automática — design

- **Data:** 2026-11-11
- **Status:** aprovada pelo usuário em 2026-11-12.
- **Issue Linear:** ILU-116 (time Iluminus).

## 1. Por quê

A gestão do estúdio lança cada mensalidade **à mão**. Na renovação do plano, ela combina com o aluno se o pagamento vai ser à vista ou mensal. No caso mensal, lança uma cobrança por mês, **no momento em que o aluno paga**.

Dois problemas atrapalham isso hoje:

1. **Cobranças que ninguém pediu.** Um agendamento em produção (`cobrancas-mensais`, todo dia 1 às 08h) chama a Edge Function `gerar-mensalidades`. Ela cria, para todo aluno ativo, uma cobrança com vencimento no dia 10. A gestão não quer isso. Ele já deixou 86 cobranças em aberto, todas virando "Atrasado" (40 de 10/10 e 46 de 10/11).
2. **Não dá para acompanhar um aluno sozinho.** Para ver o que um aluno pagou ou deve, a gestão precisa abrir a tela Financeiro ("Mensalidades"), que lista o mês inteiro de todos os alunos. O pedido é poder ver e operar as cobranças de um aluno direto no perfil dele.

**Sucesso:**

- Nenhuma cobrança nasce sem uma ação explícita da gestão.
- Pelo perfil do aluno, a gestão vê o que está em aberto e o que está pago, e consegue lançar, editar, receber, reverter e excluir.
- Qualquer dessas ações feita numa tela aparece igual na outra.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**

1. Desligar toda geração automática de mensalidades: o agendamento, a Edge Function, o botão "Criar mensalidades de {mês}" e o `financeiroService.gerarMensalidades`.
2. Criar uma aba **Financeiro** no perfil do aluno, no layout "A" escolhido (seção 4).
3. Permitir que o "Novo lançamento" crie uma cobrança **em aberto**, além do registro de pagamento já feito.
4. Criar um botão **Reverter** próprio, nas duas telas, que também desfaz o repasse do professor.

**Não-objetivos**

- **Não apagar as 86 cobranças em aberto que o agendamento já criou** (decisão do usuário). Como é dado sensível, a gestão vai analisar e apagar pela tela o que for o caso. Até lá, elas continuam aparecendo como "Atrasado" na tela Mensalidades, na aba nova e no portal do aluno (`AreaAluno` mostra as mensalidades do próprio aluno).
- **Não mudar a cobrança que a matrícula e a renovação já criam** (`matricular_aluno` / `renovar_plano_aluno`), nem a limpeza de cobranças cobertas por ciclo à vista.
- **Não mexer no agendamento `atualiza-status-inadimplencia`**, que muda `pendente → atrasado` à meia-noite. Ele continua.
- **Não mudar o bloqueio de agendamento do aluno.** Ele usa `data_fim_plano`, não mensalidades.
- **Sem atualização ao vivo** entre computadores. Cada tela mostra o estado novo ao ser aberta ou recarregada, e na mesma sessão após cada ação.
- **Não recalcular repasse ao editar o valor de uma cobrança paga.** Hoje isso não acontece e continua assim.

**Anti-objetivos (seria fracasso mesmo "funcionando")**

- As duas telas se comportarem diferente para a mesma ação. Exemplo: reverter numa limpa o repasse e na outra não.
- Repasse de professor que fica para trás, ou que é apagado, **sem a gestão ter escolhido**. Também conta como fracasso um repasse duplicado depois de reverter e receber de novo.
- Qualquer caminho, automático ou em massa, que crie cobrança sem a gestão pedir aquela cobrança específica.

## 3. Fim da geração automática

1. **Agendamento.** Uma migration **própria e pequena**, separada da RPC de reverter, desliga o job `cobrancas-mensais` com `cron.unschedule`, e só se ele existir, porque o staging pode não ter.
   - Ela pode ir para produção antes do resto. A próxima execução é **01/12 às 08:00**, e criaria mais 40 a 46 cobranças que alguém teria de apagar à mão (decisão minha, apontada na revisão).
   - A migration "down" (`supabase/migrations-down/`) **não** recria o job. O comando dele leva o header `x-cron-secret`, que não pode ir para o git.
   - Em vez disso, a down documenta em comentário como recriá-lo à mão: schedule `0 8 1 * *`, `net.http_post` para `/functions/v1/gerar-mensalidades` com os headers `Authorization` e `x-cron-secret`.
2. **Edge Function.** Remover `supabase/functions/gerar-mensalidades/` do repo, incluindo o `config.toml` com o bloco `[[cron]]`. Apagar a function publicada (`supabase functions delete gerar-mensalidades`) em staging e produção, **depois** que o agendamento estiver desligado.
3. **Botão e código do front.**
   - Em `Financeiro.jsx`, remover o botão "Criar mensalidades de {mês}", o modal de confirmação e os handlers (`handleAbrirGerarMensalidades`, `handleGerarMensalidades`, `totalAtivos`, `setGerando`).
   - Remover `financeiroService.gerarMensalidades` e os testes dele.
   - Remover os helpers que ficarem sem uso no código de produção (provavelmente `avancarUmMes` e `vencimentoCobertoPorCicloAVista` em `lib/utils.js`). Antes, conferir com grep, porque testes e outros pontos podem usá-los.
   - Comentários de código que citam "o cron gerar-mensalidades" devem ser corrigidos. Migrations já aplicadas não se editam.
   - Textos visíveis também: o toast e o diálogo de "deixar de ser bolsista" em `Alunos.jsx` falam em geração automática. O comentário em `alunosService.js` também.
   - **Não remover o secret `CRON_SECRET`.** Ele é usado também por `lembretes-aula`, `processar-notificacoes` e `gerar-presencas-diario`.
4. **Fatos de produção (2026-11-11).** Jobs ativos no `cron.job`: `despertador-lembretes`, `atualiza-status-inadimplencia`, `cobrancas-mensais` (id 5) e `confirmar-presencas-app`. Só o `cobrancas-mensais` sai.

## 4. Aba "Financeiro" no perfil do aluno (layout A)

Em `PerfilAluno.jsx`, entra uma nova aba `financeiro`, com rótulo "Financeiro", entre "Histórico" e "Frequência". O acesso é o mesmo do resto do perfil (rota `/alunos/:id`, área da gestão).

**Dados:** todas as linhas de `mensalidades` com `aluno_id` igual ao aluno, **sem filtro de período**, com todos os tipos (regular, plano livre, avulsa, experimental, produto, evento). Sem paginação: um aluno tem poucas dezenas de linhas por ano (decisão minha).

**Topo:**

- Título "Financeiro" e o botão **+ Novo lançamento**.
- Três indicadores:
  - **Em aberto:** soma de `valorDevidoMensalidade` das linhas não pagas, mais a quantidade.
  - **Pago em {ano atual}:** soma de `valor_pago` das linhas pagas com `data_pagamento` no ano atual, mais a quantidade.
  - **Último pagamento:** data e forma do pagamento mais recente, ou "—".

**Filtros:** Todas / Em aberto (pendente + atrasado) / Pagas.

**Tabela:** as mesmas colunas da tela Mensalidades, **sem a coluna Aluno**:

| Coluna | Conteúdo |
|---|---|
| Vencimento | com "há N dias" quando atrasada |
| Valor | |
| Forma | |
| Dt. Pagamento | |
| Referência | |
| Status | |
| Ações | |

- **Referência** em linha `regular` mostra o que a tela Mensalidades mostra (badge da modalidade, ou "Todas"). Nos outros tipos, mostra o nome do tipo: Plano livre, Avulsa, Experimental, Produto, Evento. Isso é decisão minha, porque nessa aba todos os tipos aparecem juntos.
- **Ordem:** a mesma da tela Mensalidades (`calcularStatusReal` + `ORDEM_STATUS`). Primeiro as atrasadas (a mais antiga no topo), depois as pendentes (o vencimento mais próximo no topo), depois as pagas (a mais recente no topo).
- **Rodapé:** contagem de registros e total, como na tela Mensalidades.

**Ações por linha**, iguais às da tela Mensalidades mais o Reverter:

- **Receber**, se não estiver paga. Abre o mesmo formulário de confirmar pagamento da tela Mensalidades, que gera o repasse.
  - Correção nas duas telas: hoje o formulário regrava `tipo_aula` como `regular` em tudo que não é experimental ou avulsa. Uma cobrança em aberto de **produto** ou **evento** viraria `regular` e geraria comissão.
  - O Receber passa a manter o tipo original desses dois e não gera repasse para eles (`TIPOS_SEM_REPASSE`). Decisão minha, apontada na revisão.
- **Reverter**, se estiver paga (seção 6).
- **Editar** (seção 7).
- **Excluir**, em qualquer linha. Se a cobrança tiver comissões, faz a mesma pergunta do Reverter (seção 6), e a gestão escolhe quais comissões saem junto.

**Novo lançamento na aba:** abre o mesmo `ModalAdicionarPagamentoManual`, com o aluno já escolhido e travado. Não oferece "visitante".

**Mesmo código nas duas telas.** O formulário de confirmar pagamento, o de editar, a confirmação de excluir, a de reverter e a linha da tabela com suas ações saem de dentro de `Financeiro.jsx` para componentes e hooks compartilhados, usados pela tela Mensalidades e pela aba. A divisão exata fica a critério de quem constrói. O que não pode acontecer é cada tela ter a sua cópia da regra.

## 5. "Novo lançamento": já pago ou em aberto

No topo do `ModalAdicionarPagamentoManual` entra uma escolha entre **Já foi pago** (padrão, igual a hoje) e **Fica em aberto**.

- **Já foi pago:** sem nenhuma mudança de comportamento. Inclui a sugestão de dar baixa numa cobrança em aberto do aluno em vez de criar outra.
- **Fica em aberto:**
  - O formulário esconde forma de pagamento e data de pagamento. Pede o tipo ou plano (e a modalidade, se regular), o **valor** e o **vencimento**.
  - Grava `status = 'pendente'`, `valor_esperado = valor`, e `valor_pago`, `forma_pagamento` e `data_pagamento` nulos.
  - Não gera repasse. O repasse nasce quando a cobrança for recebida pelo "Receber".
  - Não mostra a sugestão de "dar baixa numa cobrança em aberto".
  - Só para aluno cadastrado, não para visitante (decisão minha: cobrança em aberto de visitante não tem onde ser acompanhada).
  - Se o vencimento já passou, grava assim mesmo como `pendente`. A tela já mostra "Atrasado" pela data (`calcularStatusReal`), e o job da meia-noite acerta o status.
- **Hoje a gestão lança só quando o aluno paga** (dito pelo usuário). A opção "em aberto" existe para quando ela começar a lançar adiantado.
- O índice único `(aluno_id, plano_id, data_vencimento)` continua valendo, e a mensagem de erro de duplicidade que já existe serve para os dois casos.

## 6. Reverter pagamento

Botão **Reverter** nas linhas pagas, **nas duas telas**. Ele abre uma confirmação que mostra o valor, a data e a forma do pagamento que vão ser desfeitos.

### 6.1 A pergunta sobre a comissão (decisão do usuário, 2026-11-12)

Se o pagamento tiver comissões de professor, a confirmação lista cada uma e pergunta se ela deve ser revertida também. O espírito é dar flexibilidade: a gestão resolve caso a caso, em vez de o sistema decidir por ela. A mesma pergunta aparece no **Excluir**.

- **O que entra na lista:**
  - as linhas de `repasses_lancamentos` ligadas à cobrança (`mensalidade_id`);
  - em cobrança `regular`, também a linha do lote mensal do aluno no mês do vencimento (ver o item 2 abaixo).
- **Cada item mostra:** professor, modalidade, valor e mês. Tem uma caixa **"Reverter esta comissão também"**.
- **Mês fechado:**
  - Se o mês daquela comissão já foi fechado em Comissões (`fechamento_comissoes`), o item mostra o aviso **"Comissões de {mês} já foram fechadas — remover muda o que foi fechado"**. Não bloqueia.
  - O `valor_total` gravado no fechamento não é recalculado.
- **Padrão das caixas:** marcada para mês aberto, desmarcada para mês já fechado (decisão minha).
- **Sem comissão:** a confirmação é simples, sem a pergunta.
- **Manter uma comissão no Reverter:**
  - Ela continua ligada à cobrança.
  - Quando a cobrança for recebida de novo, o Receber **reaproveita** a comissão mantida e não gera outra. O professor não recebe duas vezes pelo mesmo pagamento.
  - Na prática: se já existe repasse ligado à cobrança, o Receber não chama `gerar-repasses` de novo (decisão minha).
- **Manter uma comissão no Excluir:**
  - A FK `repasses_lancamentos.mensalidade_id` é `ON DELETE CASCADE`. Por isso, antes de apagar a cobrança, a comissão mantida é desligada (`mensalidade_id = NULL`) e fica como lançamento avulso do professor.
  - Atenção ao índice único parcial `uq_repasse_lote_mensal` (`aluno_id, modalidade, tipo_aula, data_referencia WHERE mensalidade_id IS NULL`): quem constrói deve evitar colisão com uma linha de lote do mesmo dia.

### 6.2 O que o banco faz

O Reverter e o Excluir acontecem cada um numa **única função no banco**, por migration (por exemplo `reverter_pagamento_mensalidade(p_mensalidade_id, p_comissoes_a_remover uuid[])` e `excluir_mensalidade(p_mensalidade_id, p_comissoes_a_remover uuid[])`). São atômicas e checam `is_admin()` ou `service_role`, no mesmo padrão das RPCs da ILU-114.

- Hoje o Excluir são duas chamadas soltas do navegador. Passa a ser atômico.
- Para a tela montar a pergunta, é preciso ler as comissões da cobrança com o mês e se ele está fechado. Pode ser uma RPC de leitura ou uma consulta do service; fica a critério de quem constrói.

1. A função só remove as comissões cujo id veio em `p_comissoes_a_remover` **e** que pertencem àquela cobrança, ou à linha de lote correspondente. Ids de outras cobranças são recusados.
2. Remove as comissões escolhidas.
   - **Repasses do lote mensal** (`mensalidade_id IS NULL`, criados por `gerar-repasses-mensais`) não ficam ligados à cobrança.
   - Pela regra da ILU-13, o lote só paga comissão a quem tem mensalidade `regular` paga com vencimento naquele mês. Por isso, ao reverter ou excluir uma `regular`, a linha do lote do mesmo aluno e do mês do vencimento entra na lista da pergunta, **se não sobrar outra `regular` paga** desse aluno com vencimento naquele mês.
   - Decisão minha, apontada na revisão: sem isso, ficaria uma comissão sem pagamento por trás sem a gestão ver.
3. Volta a cobrança para aberta:
   - `status = 'atrasado'` se `data_vencimento` for anterior a hoje em Brasília; senão, `'pendente'`.
   - `valor_pago`, `forma_pagamento` e `data_pagamento` ficam nulos.
   - Se `valor_esperado` estiver nulo, recebe o `valor_pago` antigo. Assim a cobrança em aberto continua mostrando o valor certo. Lançamentos manuais pagos costumam não ter `valor_esperado` e às vezes não têm plano.
4. Se a cobrança não existir ou não estiver paga, a função não faz nada e retorna um erro claro.

Receber de novo depois de reverter usa o fluxo normal:

- **Sem comissão mantida:** o Receber gera o repasse de novo. O `gerar-repasses` já apaga os repasses da cobrança antes de inserir.
- **Com comissão mantida:** o Receber reaproveita a comissão que ficou (seção 6.1).

## 7. Editar

- O formulário de editar **deixa de ter o campo Status**, nas duas telas. Para voltar uma cobrança paga a "em aberto", usa-se o Reverter. Para pagar uma em aberto, usa-se o Receber. Assim nenhum caminho deixa repasse esquecido.
- **Linha paga:** edita vencimento, valor pago, forma, data de pagamento e modalidade (regular), como hoje.
- **Linha em aberto:** edita vencimento, **valor a receber** e modalidade (regular).
  - O valor a receber grava em `valor_esperado`, não em `valor_pago`. Isso corrige o comportamento de hoje, em que editar uma linha em aberto gravava `valor_pago` e não mudava o valor mostrado.
  - Forma e data de pagamento não aparecem.

## 8. Mesma informação nos dois lugares

As duas telas leem a mesma tabela `mensalidades`, então não existe cópia.

Depois de qualquer ação, invalidar o cache do React Query das duas telas:

- todas as chaves `['financeiro', …]`, de todos os meses;
- a chave da aba nova (sugestão: `['financeiro-aluno', alunoId]`).

O objetivo é que, ao trocar de tela na mesma sessão, nada apareça desatualizado. Hoje a tela Mensalidades tem `staleTime` de 5 minutos.

## 9. Testes e ordem de deploy

Siga `docs/DEPLOY.md` e o staging-first: migration no staging, com antes, depois e down, antes de qualquer pedido para mexer em produção. **Confirme com o usuário antes de cada passo em produção**, inclusive a remoção da Edge Function.

- **Testes unitários (vitest)** para:
  - o novo caminho "em aberto" do `adicionarPagamentoManual`;
  - a chamada de reverter no service;
  - a lista e os indicadores da aba nova (a função pura que soma e ordena);
  - a remoção de `gerarMensalidades`, garantindo que os testes antigos saiam junto.
- **Teste SQL em `scripts/sql-tests/`** para as RPCs de reverter e excluir:
  - reverter com todas as comissões marcadas → some tudo;
  - reverter com nenhuma marcada → a comissão fica ligada à cobrança, e receber de novo não duplica;
  - reverter com só uma de duas marcadas;
  - id de comissão de outra cobrança → recusa;
  - comissão de mês fechado → remove quando marcada, e o fechamento fica intacto;
  - linha de lote sem outra `regular` paga no mês → entra na lista; com outra paga → não entra;
  - excluir mantendo comissão → a comissão fica desligada (`mensalidade_id` nulo) e sobrevive ao delete;
  - cobrança não paga no reverter → erro;
  - usuário não admin → recusa;
  - `valor_esperado` nulo → recebe o valor pago.
- **Teste SQL do unschedule:** some o job quando ele existe, e não falha quando ele não existe.
- **Teste manual na branch `staging`:** pelas duas telas, lançar já pago, lançar em aberto, receber, reverter, receber de novo (o repasse aparece uma vez só), editar e excluir. Conferir que cada ação aparece igual na outra tela.
- **Ordem em produção:**
  1. Migration que desliga o agendamento. Pode ir antes de tudo, e de preferência antes de 01/12 às 08:00.
  2. Migration das RPCs.
  3. Frontend (`main`).
  4. Remoção da Edge Function `gerar-mensalidades`.

## 10. Deixado para quem constrói

- A divisão exata dos componentes e hooks compartilhados, os nomes de arquivo e as chaves de cache.
- Os detalhes visuais dentro do layout A (ícones, cores dos badges, textos dos toasts), seguindo os componentes `ui/` existentes.
- O nome final da RPC e o formato do erro, desde que a tela mostre uma mensagem em português claro.
