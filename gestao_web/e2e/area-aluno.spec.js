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

// ILU-81: no celular a sidebar some (landing.css, max-width 900px) e o aluno
// ficava preso em "Agendar Aulas", sem chegar ao Perfil, às Mensalidades nem
// ao Sair.
test.describe('Área do Aluno — navegação no celular', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('a barra inferior leva às três abas e ao Sair', async ({ page }) => {
    await loginComoAluno(page, ALUNO_EMAIL, ALUNO_SENHA);
    const barra = page.getByRole('navigation', { name: 'Menu da Área do Aluno' });
    await expect(barra).toBeVisible();

    await barra.getByRole('button', { name: 'Perfil' }).click();
    await expect(page.getByText('Seus dados pessoais e plano')).toBeVisible();

    // A barra não cobre o fim da página: o último botão do Perfil, rolado até
    // o fim, termina acima dela.
    const suporte = page.getByRole('button', { name: /Suporte via WhatsApp/ });
    await suporte.scrollIntoViewIfNeeded();
    const caixaSuporte = await suporte.boundingBox();
    const caixaBarra = await barra.boundingBox();
    expect(caixaSuporte.y + caixaSuporte.height).toBeLessThanOrEqual(caixaBarra.y);

    await barra.getByRole('button', { name: 'Mensalidades' }).click();
    await expect(page.getByText('Histórico e status dos seus pagamentos')).toBeVisible();

    await barra.getByRole('button', { name: 'Agendar' }).click();
    await expect(page.getByText('Escolha o dia e reserve sua vaga')).toBeVisible();

    // Sair desloga de verdade: voltar à Área do Aluno cai no login.
    await barra.getByRole('button', { name: 'Sair' }).click();
    await expect(page).not.toHaveURL(/\/area-aluno$/);
    await page.goto('/area-aluno');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('no computador a barra some e a sidebar continua', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginComoAluno(page, ALUNO_EMAIL, ALUNO_SENHA);

    await expect(page.getByRole('navigation', { name: 'Menu da Área do Aluno' })).toBeHidden();
    await expect(page.getByRole('button', { name: /Meu Perfil/ })).toBeVisible();
  });
});
