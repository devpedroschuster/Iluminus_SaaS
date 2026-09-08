// gestao_web/e2e/agenda.spec.js
import { test, expect } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

// Mesma lógica usada pelo app (ex.: Financeiro.jsx) para "hoje" em
// AAAA-MM-DD — usa componentes locais, não toISOString() (que é UTC e
// pode virar o dia errado perto da meia-noite).
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('Agenda — criar aula, matricular aluno, marcar presença', () => {
  test('cria uma aula avulsa, agenda um aluno e marca presença na chamada', async ({ page }) => {
    const hoje = hojeISO();
    const horario = '10:00';
    const nomeAula = `E2E Aula ${Date.now()}`;

    await loginComoAdmin(page, EMAIL, SENHA);
    await page.goto('/agenda');
    await expect(page.getByRole('heading', { name: 'Grade de Aulas' })).toBeVisible();

    // ── 1. Criar aula (evento único, hoje) — não depende de modalidade ──
    await page.getByRole('button', { name: 'Nova Aula' }).click();
    const dialogNovaAula = page.getByRole('dialog');
    await dialogNovaAula.getByRole('button', { name: 'Evento Único' }).click();
    await dialogNovaAula
      .getByPlaceholder('Ex: Reunião de equipe, Workshop, Confraternização...')
      .fill(nomeAula);
    await dialogNovaAula.locator('input[type="date"]').fill(hoje);
    await dialogNovaAula.locator('input[type="time"]').fill(horario);
    await dialogNovaAula.getByRole('button', { name: 'Agendar Evento' }).click();
    await expect(page.getByText('Grade atualizada com sucesso!')).toBeVisible({ timeout: 15_000 });

    // ── 2. Matricular o aluno de teste (avulso) nesta turma ─────────────
    await page.getByRole('button', { name: 'Agendar na Turma' }).click();
    const dialogAgendamento = page.getByRole('dialog');
    await dialogAgendamento
      .locator('select')
      .nth(0)
      .selectOption({ label: `${nomeAula} - Evento Único às ${horario}` });
    await dialogAgendamento.locator('select').nth(1).selectOption({ label: 'Aluno E2E' });
    await dialogAgendamento.locator('input[type="date"]').fill(hoje);
    await dialogAgendamento.getByRole('button', { name: 'Confirmar Agendamento' }).click();

    // O aluno de teste não tem plano vinculado (ver memória de credenciais
    // de staging) — o admin precisa confirmar o agendamento "fora do plano"
    // explicitamente. Trata os dois desfechos possíveis para não depender
    // de o aluno ter ou não um plano no momento em que o teste rodar.
    const toastAgendado = page.getByText(/agendado para/);
    const btnForcarForaDoPlano = page.getByRole('button', { name: 'Sim, agendar mesmo assim' });
    await expect(toastAgendado.or(btnForcarForaDoPlano)).toBeVisible({ timeout: 15_000 });
    if (await btnForcarForaDoPlano.isVisible()) {
      await btnForcarForaDoPlano.click();
      await expect(toastAgendado).toBeVisible({ timeout: 15_000 });
    }

    // ── 3. Marcar presença na chamada dessa aula ────────────────────────
    await page.getByRole('button', { name: 'Hoje' }).click();
    await page.locator('.rbc-event', { hasText: nomeAula }).click();
    const dialogAcoes = page.getByRole('dialog');
    await dialogAcoes.getByRole('button', { name: 'Lista de Presença' }).click();

    const dialogChamada = page.getByRole('dialog');
    await expect(dialogChamada.getByText('Aluno E2E')).toBeVisible({ timeout: 10_000 });
    await dialogChamada.getByRole('button', { name: 'Marcar Presente' }).click();
    await expect(page.getByText('Presença confirmada!')).toBeVisible({ timeout: 10_000 });
  });
});
