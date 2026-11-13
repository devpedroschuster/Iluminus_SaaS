# Página "Matrículas" (últimas matrículas) — design curto

- **Data:** 2026-11-13
- **Status:** aprovado pelo usuário em 2026-11-13.
- **Issue Linear:** a criar no time Iluminus.
- **Tamanho:** mudança pequena — só tela, sem migration nem mudança de RLS.

## Por quê

Depois que uma matrícula fecha, o estúdio manda as informações para o novo aluno fora do sistema (regras, horários, grupo etc.). Hoje não existe um lugar onde a equipe veja as matrículas mais recentes para conferir se já mandou tudo para cada uma. A lista de Alunos fica em ordem alfabética e mistura todo mundo.

**Sucesso:** a equipe abre uma página e vê as matrículas recentes, da mais nova para a mais antiga, com o nome do aluno e quando fechou.

## Objetivos, não-objetivos, anti-objetivos

- **Objetivo:** uma lista simples de matrículas recentes: nome do aluno + data em que fechou.
- **Não-objetivos:** checagens de cadastro incompleto, marcar "informações enviadas", plano/valor/pagamento na lista. A conferência de "já mandamos tudo?" fica com o estúdio, fora do sistema (pedido explícito do usuário).
- **Anti-objetivo:** virar mais uma tela cheia de colunas e filtros. Se a página precisar de explicação para ser usada, errou.

## Abordagens consideradas

1. **Página própria "Matrículas" no menu** — **escolhida pelo usuário.** É o que o estúdio pediu, fica a um clique e segue o mesmo formato simples da página de Aniversariantes.
2. Coluna "Matriculado em" + ordenação na tela Alunos — menos código, mas a lista de Alunos é alfabética e tem filtros para outros usos; as matrículas novas ficariam misturadas com todos os alunos.
3. Quadro "Últimas matrículas" no Painel Avisos — visível ao entrar, mas cabem poucas linhas e o painel já tem bastante coisa.

## Como fica

```
Matrículas                          últimos 30 dias
Aluno                       Fechou em
Maria Souza                 12/11/2026
João Pereira                10/11/2026
Ana Ribeiro                 08/11/2026
               [ Ver mais antigas ]
```

- **Menu:** item "Matrículas" no grupo "Visão Geral", logo depois de "Leads". Rota `/matriculas`, só para admin (mesmo grupo de rotas de `/alunos`).
- **Lista:** alunos (`alunos.role = 'aluno'`) ordenados por `alunos.created_at`, do mais recente para o mais antigo. Abre mostrando os últimos 30 dias.
- **Clicar no nome** abre o perfil do aluno (`/alunos/:id`).
- **Lista vazia:** mensagem simples ("Nenhuma matrícula nos últimos N dias") com o botão de ver mais antigas.

## Decisões tomadas por Claude (o usuário pode corrigir)

- **"Fechou em" = `alunos.created_at`**, o dia em que a matrícula foi cadastrada no sistema, mostrado no fuso de São Paulo. Não é `data_inicio_plano` (início do contrato), que às vezes é outra data.
- **Só matrículas novas.** Ex-aluno reativado por "Renovar / Alterar plano" não cria um novo cadastro e não aparece. Se o estúdio também manda as informações nesse caso, isso entra numa versão seguinte.
- **Aluno desativado depois continua na lista.** A matrícula fechou naquele dia; a página é um histórico, sem marcar quem saiu depois.
- **"Ver mais antigas"** amplia a janela em mais 30 dias a cada clique.

## O que fica para quem implementar

- Onde fica a consulta (ex.: uma função nova em `alunosService`) e o teste dela.
- Ícone do item no menu e detalhes de layout, seguindo os componentes de `components/ui` já usados em Aniversariantes (`Surface`, `EmptyState`, `Skeleton`).
