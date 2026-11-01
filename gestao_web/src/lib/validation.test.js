import { describe, it, expect } from 'vitest';
import { planoSchema } from './validation';

const planoBase = { nome: 'Plano Teste', preco: 150, duracao_meses: 1, regras_acesso: [] };

describe('planoSchema — frequencia_semanal (ILU-68)', () => {
  it('rejeita texto livre (a coluna planos.frequencia_semanal é integer)', async () => {
    await expect(planoSchema.validate({ ...planoBase, frequencia_semanal: 'Livre' }))
      .rejects.toThrow('Selecione a frequência semanal.');
  });

  it('rejeita frequência vazia', async () => {
    await expect(planoSchema.validate({ ...planoBase, frequencia_semanal: '' }))
      .rejects.toThrow('Selecione a frequência semanal.');
  });

  it('rejeita frequência fracionada', async () => {
    await expect(planoSchema.validate({ ...planoBase, frequencia_semanal: 2.5 }))
      .rejects.toThrow('A frequência semanal deve ser um número inteiro.');
  });

  it('rejeita frequência zero', async () => {
    await expect(planoSchema.validate({ ...planoBase, frequencia_semanal: 0 }))
      .rejects.toThrow('A frequência semanal deve ser de pelo menos 1x.');
  });

  it('aceita um número de aulas por semana', async () => {
    await expect(planoSchema.validate({ ...planoBase, frequencia_semanal: 3 })).resolves.toBeTruthy();
  });

  it('aceita o valor de plano livre (999)', async () => {
    await expect(planoSchema.validate({ ...planoBase, frequencia_semanal: 999 })).resolves.toBeTruthy();
  });
});
