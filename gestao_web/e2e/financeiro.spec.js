// gestao_web/e2e/financeiro.spec.js
import { test, expect } from '@playwright/test';
import { loginComoAdmin } from './helpers/auth.js';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const SENHA = process.env.E2E_ADMIN_PASSWORD;

test.describe('Financeiro e Comissões', () => {
  test('gerar mensalidades do mês', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
    await page.goto('/financeiro');

    await expect(page.getByRole('heading', { name: 'Financeiro' })).toBeVisible();

    await page.getByRole('button', { name: /Criar mensalidades de/ }).click();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();

    await expect(page.getByText('Mensalidades criadas com sucesso!')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('calcular repasses mensais dos professores', async ({ page }) => {
    await loginComoAdmin(page, EMAIL, SENHA);
    await page.goto('/comissoes');

    await expect(page.getByRole('heading', { name: 'Comissões e Repasses' })).toBeVisible();

    await page.getByRole('button', { name: 'Gerar Repasses' }).click();

    // O modal calcula o preview via Edge Function antes de mostrar qualquer
    // ação — espera sair do estado "carregando" (skeleton) para um dos dois
    // estados finais possíveis, sem assumir que já existe base de repasse
    // pronta na base de staging.
    const botaoConfirmar = page.getByRole('button', { name: 'Confirmar e Gerar' });
    const semRepasses = page.getByText(/Nenhum repasse previsto|Repasses já completos/);

    await expect(botaoConfirmar.or(semRepasses)).toBeVisible({ timeout: 20_000 });

    if (await botaoConfirmar.isVisible()) {
      await botaoConfirmar.click();
      await expect(page.getByText(/repasse\(s\) gerado\(s\) com sucesso!|repasse\(s\) pendente\(s\) foram completados|Nenhum repasse novo/)).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
