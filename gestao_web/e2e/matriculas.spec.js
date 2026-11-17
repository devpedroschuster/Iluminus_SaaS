// gestao_web/e2e/matriculas.spec.js
import { test, expect } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

// ILU-120: página "Matrículas" — lista das matrículas recentes (nome + quando
// fechou). Não assume dados no staging: aceita a lista ou o estado vazio.
test.describe('Matrículas', () => {
  test('lista as matrículas recentes e amplia o período', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Matrículas' }).click();
    await expect(page).toHaveURL(/\/matriculas$/);

    await expect(page.getByRole('heading', { name: 'Matrículas' })).toBeVisible();
    // exact: a mensagem de lista vazia também contém "últimos 30 dias"
    await expect(page.getByText('últimos 30 dias', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('table').or(page.getByText(/Nenhuma matrícula nos últimos 30 dias/)),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Ver mais antigas' }).click();
    await expect(page.getByText('últimos 60 dias', { exact: true })).toBeVisible();
  });
});
