// gestao_web/e2e/helpers/auth.js
import { expect } from '@playwright/test';

/**
 * Faz login como admin e espera o dashboard renderizar de verdade —
 * esperar só a URL mudar é mais flaky que esperar o heading real
 * aparecer (lição documentada no Nexofy).
 */
export async function loginComoAdmin(page, email, senha) {
  await page.goto('/login');

  await page.getByPlaceholder('Seu e-mail').fill(email);
  await page.getByPlaceholder('Sua senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Painel de Avisos' })).toBeVisible({
    timeout: 25_000,
  });
  await expect(page).toHaveURL(/\/dashboard$/);
}
