// gestao_web/e2e/auth.spec.js
import { test, expect } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

test.describe('Autenticação', () => {
  test('login com sucesso redireciona para o dashboard', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
  });

  test('login com credenciais erradas mostra mensagem de erro e permanece no login', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Seu e-mail').fill(EMAIL);
    await page.getByPlaceholder('Sua senha').fill('senha-errada-123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    await expect(page.getByText('E-mail ou senha não conferem')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rota protegida sem sessão redireciona para o login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout encerra a sessão e bloqueia rota protegida de novo', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);

    await page.getByRole('button', { name: 'Sair do Sistema' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
