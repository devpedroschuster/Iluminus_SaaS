// gestao_web/e2e/auth.spec.js
import { test } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

test.describe('Autenticação', () => {
  test('login com sucesso redireciona para o dashboard', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
  });
});
