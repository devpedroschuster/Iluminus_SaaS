// gestao_web/e2e/helpers/auth.js
import { expect } from '@playwright/test';

/**
 * Faz login como admin e espera o dashboard renderizar de verdade —
 * esperar só a URL mudar é mais flaky que esperar o heading real
 * aparecer (lição documentada no Nexofy).
 */
export async function loginComoAdmin(page, email, senha) {
  // DEBUG TEMP (ILU-CI-investigation): captura console/pageerror/network para
  // diagnosticar a falha de CI em auth.spec.js — remover depois de identificar
  // a causa raiz. Não loga valores de formulário (email/senha).
  const eventos = [];
  page.on('console', msg => eventos.push(`[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => eventos.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', req => eventos.push(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
  page.on('response', async res => {
    if (res.status() >= 400) {
      let body = '';
      try { body = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      eventos.push(`[response ${res.status()}] ${res.request().method()} ${res.url()} — ${body}`);
    }
  });

  await page.goto('/login');

  await page.getByPlaceholder('Seu e-mail').fill(email);
  await page.getByPlaceholder('Sua senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  try {
    await expect(page.getByRole('heading', { name: 'Painel de Avisos' })).toBeVisible({
      timeout: 25_000,
    });
  } catch (err) {
    console.log('[DEBUG loginComoAdmin] current URL:', page.url());
    console.log('[DEBUG loginComoAdmin] captured events:\n' + eventos.join('\n'));
    throw err;
  }
  await expect(page).toHaveURL(/\/dashboard$/);
}
