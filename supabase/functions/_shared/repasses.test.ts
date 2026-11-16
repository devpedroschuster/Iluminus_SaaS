import { assertEquals } from 'jsr:@std/assert@1';
import {
  avisoDaLinha,
  cobrancaDeMesFuturo,
  mesAtualBrasilia,
  resumirPorProfessor,
  type LinhaApuracao,
} from './repasses.ts';

function linha(p: Partial<LinhaApuracao>): LinhaApuracao {
  return {
    aluno_id: 1,
    aluno_nome: 'Ana',
    modalidade_id: 'mod-1',
    modalidade: 'Dança',
    professor_id: 'prof-1',
    tipo_aula: 'regular',
    competencia: '2026-10-01',
    data_referencia: '2026-10-01',
    valor: '50.00',
    mensalidade_id: null,
    situacao: 'gerada',
    ...p,
  };
}

Deno.test('avisoDaLinha: sem_cobertura com modalidade', () => {
  assertEquals(avisoDaLinha(linha({ situacao: 'sem_cobertura' })), 'Ana (Dança): Mês não pago');
});

Deno.test('avisoDaLinha: bolsista sem modalidade', () => {
  assertEquals(
    avisoDaLinha(linha({ situacao: 'bolsista', modalidade: null, modalidade_id: null })),
    'Ana: Bolsista',
  );
});

Deno.test('avisoDaLinha: gerada e ja_existia não geram aviso', () => {
  assertEquals(avisoDaLinha(linha({ situacao: 'gerada' })), null);
  assertEquals(avisoDaLinha(linha({ situacao: 'ja_existia' })), null);
});

Deno.test('avisoDaLinha: rótulos das demais situações', () => {
  const esperado: Record<string, string> = {
    pausado: 'Plano pausado no mês',
    inativo: 'Aluno inativo',
    sem_professor: 'Modalidade sem professor',
    plano_livre_sem_presenca: 'Plano livre sem presença no mês',
    plano_livre_mes_em_andamento: 'Plano livre: entra quando o mês terminar',
    removida_pela_gestao: 'Comissão removida pela gestão',
  };
  for (const [situacao, rotulo] of Object.entries(esperado)) {
    assertEquals(avisoDaLinha(linha({ situacao })), `Ana (Dança): ${rotulo}`);
  }
});

Deno.test('mesAtualBrasilia: usa o fuso de Brasília na virada do mês', () => {
  assertEquals(mesAtualBrasilia(new Date('2026-12-01T01:00:00Z')), '2026-11'); // 30/11 22:00 em Brasília
  assertEquals(mesAtualBrasilia(new Date('2026-12-01T03:00:00Z')), '2026-12'); // 01/12 00:00 em Brasília
});

Deno.test('cobrancaDeMesFuturo: só vencimento num mês depois do atual em Brasília', () => {
  const agora = new Date('2026-12-01T01:00:00Z'); // 30/11 22:00 em Brasília
  assertEquals(cobrancaDeMesFuturo('2026-12-01', agora), true);
  assertEquals(cobrancaDeMesFuturo('2027-01-10', agora), true);
  assertEquals(cobrancaDeMesFuturo('2026-11-30', agora), false);
  assertEquals(cobrancaDeMesFuturo('2026-10-10', agora), false);
  assertEquals(cobrancaDeMesFuturo(null, agora), false);
});

Deno.test('resumirPorProfessor soma 50.00 + 16.66 + 16.67 e ignora ja_existia', () => {
  const linhas = [
    linha({ valor: '50.00' }),
    linha({ valor: '16.66', tipo_aula: 'plano_livre' }),
    linha({ valor: '16.67', tipo_aula: 'plano_livre' }),
    linha({ valor: '99.00', situacao: 'ja_existia' }),
    linha({ professor_id: 'prof-2', valor: '10.00' }),
  ];
  const r = resumirPorProfessor(linhas, new Map([['prof-1', 'Marta']]));
  assertEquals(r.length, 2);
  assertEquals(r[0], {
    professor_id: 'prof-1',
    nome: 'Marta',
    total: 83.33,
    qtdLancamentos: 3,
    breakdown: { regular: 50, plano_livre: 33.33 },
  });
  assertEquals(r[1].nome, 'Professor');
  assertEquals(r[1].total, 10);
});
