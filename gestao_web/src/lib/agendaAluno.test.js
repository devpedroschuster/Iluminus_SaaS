import { describe, it, expect } from 'vitest';
import {
  somarDias, formatarDiaMes, montarDias, aulasDoDia, inicioDaSemana, consumoDaSemana,
  acaoDoCartao, avisoDoPlano, rotuloStatus, nomeProfessor, diasComAula, painelDeErro, aulasParaMostrar,
  avisosDosPlanos, consumoVisivel,
} from './agendaAluno';

// ILU-114: com o plano pausado não há o que agendar; a lista só mostra o que já
// tem registro (ex.: a gestão agendou o aluno mesmo pausado).
describe('aulasParaMostrar', () => {
  const aulas = [
    { aula_id: 1, data: '2026-11-09', meu_status: null },
    { aula_id: 2, data: '2026-11-09', meu_status: 'agendado' },
    { aula_id: 3, data: '2026-11-09', meu_status: 'cancelado' },
    { aula_id: 4, data: '2026-11-10', meu_status: 'agendado' },
  ];
  const ids = (lista) => lista.map((a) => a.aula_id);

  it('plano normal: todas as aulas do dia', () => {
    expect(ids(aulasParaMostrar(aulas, { pausado_desde: null }, '2026-11-09'))).toEqual([1, 2, 3]);
  });

  it('plano pausado: só o que tem registro ativo naquele dia', () => {
    expect(ids(aulasParaMostrar(aulas, { pausado_desde: '2026-11-01' }, '2026-11-09'))).toEqual([2]);
  });

  it('sem plano: todas as aulas do dia', () => {
    expect(ids(aulasParaMostrar(aulas, null, '2026-11-09'))).toEqual([1, 2, 3]);
  });
});

// ILU-95: o painel de erro só substitui a lista quando não há lista; o
// detalhe é só a recusa do servidor (P0001), nunca erro técnico de rede.
describe('painelDeErro', () => {
  const dados = { hoje: '2026-10-11', aulas: [] };

  it('não aparece quando já há lista na tela (recarga em segundo plano falhou)', () => {
    expect(painelDeErro(dados, { codigo: 'P0001', message: 'Sua conta está desativada.' })).toBeNull();
  });

  it('sem lista, mostra a recusa do servidor como detalhe', () => {
    expect(painelDeErro(undefined, { codigo: 'P0001', message: 'Sua conta está desativada.' }))
      .toEqual({ detalhe: 'Sua conta está desativada.' });
  });

  it('sem lista e com falha de rede, não mostra o texto técnico', () => {
    expect(painelDeErro(undefined, { message: 'TypeError: Failed to fetch' })).toEqual({ detalhe: null });
  });
});

// ILU-78/79/80: a aba "Agendar Aulas" só organiza o que listar_aulas_aluno
// devolve — as regras ficam no servidor.
describe('montarDias', () => {
  it('monta 14 dias a partir do hoje do servidor, com "Hoje" no primeiro', () => {
    const dias = montarDias('2026-10-09');
    expect(dias).toHaveLength(14);
    expect(dias[0]).toEqual({ data: '2026-10-09', rotulo: 'Hoje', diaMes: '09/10' });
    expect(dias[1]).toEqual({ data: '2026-10-10', rotulo: 'Sáb', diaMes: '10/10' });
    expect(dias[3].rotulo).toBe('Seg');
    expect(dias[13].data).toBe('2026-10-22');
  });

  it('atravessa a virada do ano sem pular nem repetir dia', () => {
    const dias = montarDias('2026-12-25');
    expect(dias.map((d) => d.data)).toContain('2027-01-01');
    expect(dias[13].data).toBe('2027-01-07');
    expect(new Set(dias.map((d) => d.data)).size).toBe(14);
  });
});

describe('somarDias / formatarDiaMes', () => {
  it('soma e subtrai dias atravessando o mês', () => {
    expect(somarDias('2026-10-30', 3)).toBe('2026-11-02');
    expect(somarDias('2026-11-02', -3)).toBe('2026-10-30');
  });
  it('formata DD/MM', () => {
    expect(formatarDiaMes('2026-10-04')).toBe('04/10');
  });
});

describe('aulasDoDia', () => {
  it('filtra pela data', () => {
    const aulas = [{ aula_id: 1, data: '2026-10-13' }, { aula_id: 2, data: '2026-10-14' }];
    expect(aulasDoDia(aulas, '2026-10-14')).toEqual([{ aula_id: 2, data: '2026-10-14' }]);
    expect(aulasDoDia(undefined, '2026-10-14')).toEqual([]);
  });
});

describe('inicioDaSemana / consumoDaSemana (semana de segunda a domingo, como o servidor)', () => {
  it('volta para a segunda-feira', () => {
    expect(inicioDaSemana('2026-10-09')).toBe('2026-10-05'); // sexta
    expect(inicioDaSemana('2026-10-11')).toBe('2026-10-05'); // domingo
    expect(inicioDaSemana('2026-10-12')).toBe('2026-10-12'); // segunda
    expect(inicioDaSemana('2026-11-01')).toBe('2026-10-26'); // domingo, mês anterior
  });
  it('pega o consumo da semana do dia escolhido', () => {
    const consumo = [
      { semana_inicio: '2026-10-05', area: 'Dança', uso: 1, limite: 2, livre: false },
      { semana_inicio: '2026-10-12', area: 'Dança', uso: 0, limite: 2, livre: false },
    ];
    expect(consumoDaSemana(consumo, '2026-10-11')).toEqual([consumo[0]]);
    expect(consumoDaSemana(undefined, '2026-10-11')).toEqual([]);
  });
});

describe('acaoDoCartao', () => {
  it('mostra Cancelar quando o servidor deixa cancelar', () => {
    expect(acaoDoCartao({ meu_status: 'agendado', pode_cancelar: true, pode_agendar: false }))
      .toEqual({ tipo: 'cancelar', texto: 'Cancelar' });
  });
  it('mostra Agendar, ou "Agendar de novo" depois de um cancelamento', () => {
    expect(acaoDoCartao({ meu_status: null, pode_agendar: true, pode_cancelar: false }))
      .toEqual({ tipo: 'agendar', texto: 'Agendar' });
    expect(acaoDoCartao({ meu_status: 'cancelado', pode_agendar: true, pode_cancelar: false }))
      .toEqual({ tipo: 'agendar', texto: 'Agendar de novo' });
  });
  it('mostra o motivo do servidor no lugar do botão', () => {
    expect(acaoDoCartao({ meu_status: null, pode_agendar: false, pode_cancelar: false, motivo: 'Turma lotada.' }))
      .toEqual({ tipo: 'info', texto: 'Turma lotada.' });
  });
  it('não mostra nada quando não há ação nem motivo (ex.: presente)', () => {
    expect(acaoDoCartao({ meu_status: 'presente', pode_agendar: false, pode_cancelar: false, motivo: null }))
      .toEqual({ tipo: 'info', texto: '' });
  });
});

describe('avisoDoPlano', () => {
  // ILU-114: plano pausado explica por que nada pode ser agendado, mesmo com o
  // vencimento original já no passado (os dias voltam na retomada).
  it('plano pausado: aviso de pausa, antes de qualquer aviso de vencimento', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-04', bloqueia_a_partir_de: '2026-10-09', pausado_desde: '2026-09-20' }, '2026-10-09')).toEqual({
      tom: 'pausa',
      texto: 'Seu plano está pausado desde 20/09. Para voltar às aulas, fale com a recepção.',
    });
  });
  it('sem plano ou sem data de fim: nenhum aviso', () => {
    expect(avisoDoPlano(null, '2026-10-09')).toBeNull();
    expect(avisoDoPlano({ data_fim: null, bloqueia_a_partir_de: null }, '2026-10-09')).toBeNull();
  });
  it('plano em dia (vence hoje ou depois): nenhum aviso', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-09', bloqueia_a_partir_de: '2026-10-14' }, '2026-10-09')).toBeNull();
  });
  it('vencido há menos de 5 dias: aviso com a data limite para renovar', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-06', bloqueia_a_partir_de: '2026-10-11' }, '2026-10-09')).toEqual({
      tom: 'aviso',
      texto: 'Seu plano venceu em 06/10. Renove até 10/10 para continuar agendando.',
    });
  });
  it('a partir do 5º dia de vencido: bloqueio', () => {
    expect(avisoDoPlano({ data_fim: '2026-10-04', bloqueia_a_partir_de: '2026-10-09' }, '2026-10-09')).toEqual({
      tom: 'bloqueio',
      texto: 'Seu plano venceu em 04/10. Renove para voltar a agendar.',
    });
  });
});

describe('rótulos', () => {
  it('rotuloStatus', () => {
    expect(rotuloStatus('agendado')).toBe('Agendado');
    expect(rotuloStatus('fixo')).toBe('Horário fixo');
    expect(rotuloStatus('cancelado')).toBe('Cancelado');
    expect(rotuloStatus('falta')).toBe('Falta');
    expect(rotuloStatus('presente')).toBe('Presente');
    expect(rotuloStatus(null)).toBeNull();
  });
  it('nomeProfessor (aula sem professor não quebra)', () => {
    expect(nomeProfessor({ professor: 'Zuleica' })).toBe('Prof. Zuleica');
    expect(nomeProfessor({ professor: null })).toBe('Professor a definir');
  });
  it('diasComAula marca só agendado, fixo e presente', () => {
    const aulas = [
      { data: '2026-10-13', meu_status: 'agendado' },
      { data: '2026-10-14', meu_status: 'cancelado' },
      { data: '2026-10-15', meu_status: 'fixo' },
      { data: '2026-10-16', meu_status: null },
    ];
    expect([...diasComAula(aulas)].sort()).toEqual(['2026-10-13', '2026-10-15']);
    expect(diasComAula(undefined).size).toBe(0);
  });
});

// ILU-127 (entrega 4): cada plano do aluno tem o próprio aviso.
describe('avisosDosPlanos', () => {
  const hoje = '2026-10-09';
  const A = { plano_aluno_id: 'a', nome: 'Mensal', data_fim: '2026-11-30', bloqueia_a_partir_de: '2026-12-05', pausado_desde: null, encerrado_em: null };

  it('A1: um plano vencido devolve exatamente o aviso de hoje', () => {
    const plano = { plano_aluno_id: 'a', nome: 'Mensal', data_fim: '2026-10-07', bloqueia_a_partir_de: '2026-10-12', pausado_desde: null, encerrado_em: null };
    const [aviso] = avisosDosPlanos([plano], hoje);
    expect({ tom: aviso.tom, texto: aviso.texto }).toEqual(avisoDoPlano(plano, hoje));
    expect(aviso.planoAlunoId).toBe('a');
  });

  it('sem avisos: lista vazia', () => {
    expect(avisosDosPlanos([A], hoje)).toEqual([]);
    expect(avisosDosPlanos([], hoje)).toEqual([]);
  });

  it('A2: dois planos, só o B vencido: um aviso com o nome do B', () => {
    const B = { plano_aluno_id: 'b', nome: 'Dança', data_fim: '2026-10-06', bloqueia_a_partir_de: '2026-10-11', pausado_desde: null, encerrado_em: null };
    expect(avisosDosPlanos([A, B], hoje)).toEqual([{
      tom: 'aviso', planoAlunoId: 'b',
      texto: 'Seu plano Dança venceu em 06/10. Renove até 10/10 para continuar agendando.',
    }]);
  });

  it('pausa com vários planos leva o nome', () => {
    const B = { ...A, plano_aluno_id: 'b', nome: 'Dança', pausado_desde: '2026-09-20' };
    expect(avisosDosPlanos([A, B], hoje)[0].texto)
      .toBe('Seu plano Dança está pausado desde 20/09. Para voltar às aulas, fale com a recepção.');
  });

  it('A4: plano encerrado avisa que termina', () => {
    const B = { ...A, plano_aluno_id: 'b', nome: 'Dança', encerrado_em: '2026-10-11' };
    expect(avisosDosPlanos([A, B], hoje)).toEqual([{
      tom: 'aviso', planoAlunoId: 'b', texto: 'Seu plano Dança termina em 11/10.',
    }]);
  });

  it('plano encerrado, a partir do bloqueio: terminou', () => {
    const B = { ...A, plano_aluno_id: 'b', nome: 'Dança', encerrado_em: '2026-10-01', data_fim: '2026-10-01', bloqueia_a_partir_de: '2026-10-06' };
    expect(avisosDosPlanos([A, B], hoje)).toEqual([{
      tom: 'bloqueio', planoAlunoId: 'b', texto: 'Seu plano Dança terminou em 01/10.',
    }]);
  });

  it('um plano encerrado, sem nome no texto', () => {
    expect(avisosDosPlanos([{ ...A, encerrado_em: '2026-10-11' }], hoje)[0].texto).toBe('Seu plano termina em 11/10.');
  });
});

describe('aulasParaMostrar com vários planos', () => {
  const aulas = [
    { aula_id: 1, data: '2026-11-09', meu_status: null, plano_aluno_id: 'a' },
    { aula_id: 2, data: '2026-11-09', meu_status: null, plano_aluno_id: 'b' },
    { aula_id: 3, data: '2026-11-09', meu_status: 'agendado', plano_aluno_id: 'b' },
  ];
  const ids = (l) => l.map((a) => a.aula_id);

  it('A3: B pausado esconde as aulas livres de B; A e a já agendada ficam', () => {
    const planos = [{ plano_aluno_id: 'a', pausado_desde: null }, { plano_aluno_id: 'b', pausado_desde: '2026-11-01' }];
    expect(ids(aulasParaMostrar(aulas, planos, '2026-11-09'))).toEqual([1, 3]);
  });

  it('um plano pausado só: igual a hoje', () => {
    expect(ids(aulasParaMostrar(aulas, [{ plano_aluno_id: 'a', pausado_desde: '2026-11-01' }], '2026-11-09'))).toEqual([3]);
  });
});

describe('consumoVisivel', () => {
  const consumo = [{ plano_aluno_id: 'a', area: 'Dança' }, { plano_aluno_id: 'b', area: 'Funcional' }];
  it('esconde o consumo de plano pausado', () => {
    const planos = [{ plano_aluno_id: 'a', pausado_desde: null }, { plano_aluno_id: 'b', pausado_desde: '2026-11-01' }];
    expect(consumoVisivel(consumo, planos)).toEqual([consumo[0]]);
  });
  it('um plano pausado só: nada', () => {
    expect(consumoVisivel(consumo, [{ plano_aluno_id: 'a', pausado_desde: '2026-11-01' }])).toEqual([]);
  });
});
