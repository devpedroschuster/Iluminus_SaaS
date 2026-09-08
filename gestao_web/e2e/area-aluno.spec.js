// gestao_web/e2e/area-aluno.spec.js
import { test, expect } from '@playwright/test';
import { loginComoAdmin, loginComoAluno } from './helpers/auth.js';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_SENHA = process.env.E2E_ADMIN_PASSWORD;
const ALUNO_EMAIL = process.env.E2E_ALUNO_EMAIL;
const ALUNO_SENHA = process.env.E2E_ALUNO_PASSWORD;

test.describe('Área do Aluno — login e permissões', () => {
  test('login do aluno redireciona para a Área do Aluno, não para o dashboard admin', async ({ page }) => {
    await loginComoAluno(page, ALUNO_EMAIL, ALUNO_SENHA);
  });

  test('aluno não acessa rota exclusiva de admin — é redirecionado de volta para a Área do Aluno', async ({ page }) => {
    await loginComoAluno(page, ALUNO_EMAIL, ALUNO_SENHA);

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/area-aluno$/);
    await expect(page.getByText('Agendar Aulas', { exact: true })).toBeVisible();
  });

  test('admin não acessa a Área do Aluno — é redirecionado de volta para o dashboard', async ({ page }) => {
    await loginComoAdmin(page, ADMIN_EMAIL, ADMIN_SENHA);

    await page.goto('/area-aluno');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Painel de Avisos' })).toBeVisible();
  });
});
