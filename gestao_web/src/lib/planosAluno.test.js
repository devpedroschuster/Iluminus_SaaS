import { describe, it, expect } from 'vitest';
import {
  planosValidos,
  situacaoPlano,
  situacaoAluno,
  rotuloPlanoAluno,
  planoSugerido,
  usoPorPlanoEArea,
  validarModalidades,
  montarItensModalidades,
  notificacoesDeVencimento,
} from './planosAluno';

const HOJE = '2026-11-23';

let seq = 0;
const plano = (extra = {}, nome = 'Plano') => {
  seq += 1;
  return {
    id: `pa-${seq}`,
    plano_id: `p-${seq}`,
    data_inicio: '2026-09-01',
    data_fim: '2026-12-31',
    pausado_desde: null,
    encerrado_em: null,
    encerramento_efetivado: false,
    created_at: `2026-09-01T10:00:0${seq % 10}Z`,
    planos: { nome, regras_acesso: [], is_plano_livre: false, preco: 100, duracao_meses: 3 },
    ...extra,
  };
};

describe('planosAluno', () => {
  it('U1: aluno com um plano só não vê diferença', () => {
    const A = plano({}, 'Mensal');
    expect(planoSugerido([A], null)).toBe(A.id);
    expect(situacaoAluno([A], HOJE).varios).toBe(false);
    expect(rotuloPlanoAluno(A, [A])).toBe('Mensal');
  });

  it('U2: notificação de um plano mantém o id antigo', () => {
    const A = plano({ data_fim: '2026-11-25' }, 'Mensal');
    const linhas = [{ ...A, alunos: { id: 10, nome_completo: 'Ana', telefone: '1', ativo: true } }];
    const [n] = notificacoesDeVencimento(linhas, HOJE);
    expect(n.idUnico).toBe('venc-10-2026-11-25');
    expect(n.tipo).toBe('vencimento');
    expect(n.diasFaltando).toBe(2);
    expect(n.dataAlvo).toBe('2026-11-25');
    expect(n.aluno.planos.nome).toBe('Mensal');
  });

  it('U3: dois planos levam o id do plano e o nome de cada um', () => {
    const aluno = { id: 10, nome_completo: 'Ana', telefone: '1', ativo: true };
    const A = plano({ data_fim: '2026-11-25' }, 'Ballet');
    const B = plano({ data_fim: '2026-11-26' }, 'Jazz');
    const ns = notificacoesDeVencimento(
      [{ ...A, alunos: aluno }, { ...B, alunos: aluno }],
      HOJE
    );
    expect(ns.map((n) => n.idUnico)).toEqual([
      `venc-10-${A.id}-2026-11-25`,
      `venc-10-${B.id}-2026-11-26`,
    ]);
    expect(ns.map((n) => n.aluno.planos.nome)).toEqual(['Ballet', 'Jazz']);
  });

  it('S1: situacaoPlano nas bordas', () => {
    expect(situacaoPlano(plano({ data_fim: HOJE }), HOJE)).toMatchObject({
      codigo: 'vencendo', dias: 0, rotulo: 'Vence hoje', tone: 'warning', encerrando: false,
    });
    expect(situacaoPlano(plano({ data_fim: '2026-11-30' }), HOJE)).toMatchObject({
      codigo: 'vencendo', dias: 7, rotulo: 'Vence em 7 dias',
    });
    expect(situacaoPlano(plano({ data_fim: '2026-11-24' }), HOJE).rotulo).toBe('Vence em 1 dia');
    expect(situacaoPlano(plano({ data_fim: '2026-12-01' }), HOJE)).toMatchObject({
      codigo: 'em_dia', rotulo: 'Em dia', tone: 'success',
    });
    expect(situacaoPlano(plano({ data_fim: '2026-11-22' }), HOJE)).toMatchObject({
      codigo: 'vencido', rotulo: 'Venceu há 1 dia', tone: 'destructive',
    });
    expect(situacaoPlano(plano({ data_fim: '2026-11-20' }), HOJE).rotulo).toBe('Venceu há 3 dias');
    expect(situacaoPlano(plano({ data_fim: null }), HOJE)).toMatchObject({
      codigo: 'sem_data', dias: null, rotulo: 'Sem data', tone: 'neutral',
    });
    expect(situacaoPlano(plano({ data_fim: '2026-11-01', pausado_desde: '2026-11-10' }), HOJE)).toMatchObject({
      codigo: 'pausado', rotulo: 'Pausado desde 10/11', tone: 'info',
    });
  });

  it('S2: situacaoAluno escolhe a pior situação', () => {
    const emDia = plano({ data_fim: '2026-12-31' });
    const vencido = plano({ data_fim: '2026-11-10' });
    const r1 = situacaoAluno([emDia, vencido], HOJE);
    expect(r1.plano).toBe(vencido);
    expect(r1.situacao.codigo).toBe('vencido');
    expect(r1.varios).toBe(true);

    const v5 = plano({ data_fim: '2026-11-28' });
    const v2 = plano({ data_fim: '2026-11-25' });
    expect(situacaoAluno([v5, v2], HOJE).plano).toBe(v2);

    const pausado = plano({ pausado_desde: '2026-11-01' });
    const ok = plano({ data_fim: '2026-12-31' });
    expect(situacaoAluno([pausado, ok], HOJE).plano).toBe(ok);

    const p2 = plano({ pausado_desde: '2026-11-02' });
    const r4 = situacaoAluno([pausado, p2], HOJE);
    expect(r4.situacao.codigo).toBe('pausado');
    expect(r4.varios).toBe(true);
  });

  it('S3: nomes iguais ganham a data de início', () => {
    const a = plano({ data_inicio: '2026-09-01' }, '2x Dança');
    const b = plano({ data_inicio: '2026-11-01' }, '2x Dança');
    expect(rotuloPlanoAluno(a, [a, b])).toBe('2x Dança (desde 01/09/26)');
    expect(rotuloPlanoAluno(b, [a, b])).toBe('2x Dança (desde 01/11/26)');
  });

  it('S4: planoSugerido', () => {
    const A = plano();
    const B = plano();
    const X = plano();
    expect(planoSugerido([A, B], null)).toBeNull();
    expect(planoSugerido([A, B], B.id)).toBe(B.id);
    expect(planoSugerido([A], X.id)).toBe(A.id);
    expect(planoSugerido([], null)).toBeNull();
  });

  it('S5: plano encerrando ainda é válido e mostra a data', () => {
    const p = plano({ encerrado_em: '2026-12-03', data_fim: '2026-12-03' });
    expect(planosValidos([p], HOJE)).toEqual([p]);
    expect(situacaoPlano(p, HOJE)).toMatchObject({
      encerrando: true, rotulo: 'Encerra em 03/12', tone: 'neutral', codigo: 'em_dia',
    });
  });

  it('S5b: encerrando e vencido continua vencido', () => {
    const p = plano({ encerrado_em: HOJE, data_fim: '2026-11-20' });
    expect(situacaoPlano(p, HOJE)).toMatchObject({
      encerrando: true, codigo: 'vencido', rotulo: 'Venceu há 3 dias', tone: 'destructive',
    });
  });

  it('S6: plano encerrado ontem some de tudo', () => {
    const aluno = { id: 10, nome_completo: 'Ana', telefone: '1', ativo: true };
    const p = plano({ encerrado_em: '2026-11-22', data_fim: '2026-11-25' });
    expect(planosValidos([p], HOJE)).toEqual([]);
    expect(situacaoAluno([p], HOJE)).toBeNull();
    expect(notificacoesDeVencimento([{ ...p, alunos: aluno }], HOJE)).toEqual([]);
  });

  it('S7: sem encerramento, vencido há 30 dias continua', () => {
    const aluno = { id: 10, nome_completo: 'Ana', telefone: '1', ativo: true };
    const p = plano({ data_fim: '2026-10-24' });
    expect(situacaoPlano(p, HOJE).codigo).toBe('vencido');
    const [n] = notificacoesDeVencimento([{ ...p, alunos: aluno }], HOJE);
    expect(n.diasFaltando).toBe(-30);
  });

  it('notificações: pula pausado, aluno inativo e fora da janela', () => {
    const ativo = { id: 1, nome_completo: 'A', telefone: '1', ativo: true };
    const inativo = { id: 2, nome_completo: 'B', telefone: '2', ativo: false };
    const linhas = [
      { ...plano({ data_fim: '2026-11-25', pausado_desde: '2026-11-20' }), alunos: ativo },
      { ...plano({ data_fim: '2026-11-25' }), alunos: inativo },
      { ...plano({ data_fim: '2026-12-01' }), alunos: ativo },
      { ...plano({ data_fim: '2026-09-01' }), alunos: ativo },
    ];
    expect(notificacoesDeVencimento(linhas, HOJE)).toEqual([]);
  });

  describe('validação de modalidades', () => {
    const A = plano({}, 'Plano A');
    const B = plano({}, 'Plano B');
    A.planos.regras_acesso = [{ modalidade: 'Dança', limite: 2 }];
    B.planos.regras_acesso = [{ modalidade: 'Funcional', limite: 1 }];
    const area = { X: 'Dança', Y: 'Dança', Z: 'Funcional' };

    it('V1: dentro do limite e mensagens', () => {
      expect(validarModalidades({
        contagem: { X: 2, Z: 1 }, planoPorModalidade: { X: A.id, Z: B.id },
        planos: [A, B], areaPorModalidade: area,
      })).toBeNull();
      expect(validarModalidades({
        contagem: { X: 3 }, planoPorModalidade: { X: A.id },
        planos: [A, B], areaPorModalidade: area,
      })).toBe('O plano Plano A permite 2x em Dança.');
      expect(validarModalidades({
        contagem: { Z: 1 }, planoPorModalidade: { Z: A.id },
        planos: [A, B], areaPorModalidade: area,
      })).toBe('O plano Plano A não inclui Funcional.');
      expect(validarModalidades({
        contagem: { X: 1 }, planoPorModalidade: {},
        planos: [A, B], areaPorModalidade: area,
      })).toBe('Escolha o plano de cada modalidade.');
    });

    it('V1b: limite 999 é sem limite', () => {
      const L = plano({}, 'Livre');
      L.planos.regras_acesso = [{ modalidade: 'Dança', limite: 999 }];
      expect(validarModalidades({
        contagem: { X: 50 }, planoPorModalidade: { X: L.id },
        planos: [L], areaPorModalidade: area,
      })).toBeNull();
    });

    it('V2: limites independentes por plano', () => {
      const P1 = plano({}, 'P1');
      const P2 = plano({}, 'P2');
      P1.planos.regras_acesso = [{ modalidade: 'Dança', limite: 1 }];
      P2.planos.regras_acesso = [{ modalidade: 'Dança', limite: 1 }];
      expect(validarModalidades({
        contagem: { X: 1, Y: 1 }, planoPorModalidade: { X: P1.id, Y: P2.id },
        planos: [P1, P2], areaPorModalidade: area,
      })).toBeNull();
    });

    it('usoPorPlanoEArea soma por plano e área', () => {
      const uso = usoPorPlanoEArea({ X: 1, Y: 2, Z: 1 }, { X: A.id, Y: A.id, Z: B.id }, area);
      expect(uso.get(A.id).get('Dança')).toBe(3);
      expect(uso.get(B.id).get('Funcional')).toBe(1);
    });

    it('V3: montarItensModalidades só com vezes > 0', () => {
      expect(montarItensModalidades({ X: 2, Y: 0 }, { X: A.id })).toEqual([
        { modalidade_id: 'X', vezes: 2, plano_aluno_id: A.id },
      ]);
    });
  });
});
