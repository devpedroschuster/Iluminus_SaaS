import { describe, it, expect } from 'vitest';
import {
  emPausaNaData, calcularRetomada, anexarPausas, removerFixosEmPausa, fixosForaDePausa,
  notificacoesDePausa, cobrancasRemoviveis, diasDevolvidosNoCiclo, consultasAfetadasPelaPausa,
} from './pausaPlano';

// Depois de pausar ou retomar, as telas abertas em seguida não podem usar o
// que já tinham carregado: a grade mostrava por até 5 minutos a reserva que a
// pausa acabou de cancelar.
describe('consultasAfetadasPelaPausa', () => {
  const chaves = consultasAfetadasPelaPausa('7');

  it('atualiza as reservas e os fixos da grade', () => {
    expect(chaves).toContainEqual(['agenda']);
    expect(chaves).toContainEqual(['matriculas-fixas']);
  });

  it('atualiza o perfil do aluno, o financeiro e os avisos', () => {
    expect(chaves).toContainEqual(['aluno', '7']);
    expect(chaves).toContainEqual(['aluno-pausas', '7']);
    expect(chaves).toContainEqual(['aluno-planos-aluno', '7']);
    expect(chaves).toContainEqual(['financeiro']);
    expect(chaves).toContainEqual(['notificacoes-gerais']);
  });
});

// ILU-114: o servidor decide (pausar_plano_aluno / retomar_plano_aluno); aqui
// ficam as contas que as telas mostram antes de confirmar e os filtros de quem
// não aparece nas aulas durante a pausa.
describe('emPausaNaData', () => {
  const encerrada = [{ data_inicio: '2026-11-10', data_retorno: '2026-11-20' }];

  it('o dia do início conta como pausado', () => {
    expect(emPausaNaData(encerrada, '2026-11-10')).toBe(true);
  });

  it('o dia da volta já não conta como pausado', () => {
    expect(emPausaNaData(encerrada, '2026-11-19')).toBe(true);
    expect(emPausaNaData(encerrada, '2026-11-20')).toBe(false);
  });

  it('antes do início não está pausado', () => {
    expect(emPausaNaData(encerrada, '2026-11-09')).toBe(false);
  });

  it('pausa aberta vale para qualquer data daí em diante', () => {
    expect(emPausaNaData([{ data_inicio: '2026-11-10', data_retorno: null }], '2030-01-01')).toBe(true);
  });

  it('sem pausas, não está pausado', () => {
    expect(emPausaNaData(undefined, '2026-11-10')).toBe(false);
    expect(emPausaNaData([], '2026-11-10')).toBe(false);
  });
});

describe('calcularRetomada', () => {
  it('soma os dias pausados ao vencimento (exemplo aprovado: 51 dias, de 31/12 para 20/02)', () => {
    expect(calcularRetomada({
      dataInicioPausa: '2026-11-15', dataRetorno: '2027-01-05',
      dataInicioPlano: '2026-07-01', dataFimPlano: '2026-12-31',
    })).toEqual({ dias: 51, novoFim: '2027-02-20' });
  });

  it('voltar no mesmo dia não devolve nada', () => {
    expect(calcularRetomada({
      dataInicioPausa: '2026-11-15', dataRetorno: '2026-11-15',
      dataInicioPlano: '2026-07-01', dataFimPlano: '2026-12-31',
    })).toEqual({ dias: 0, novoFim: '2026-12-31' });
  });

  it('só contam os dias dentro do ciclo, como no servidor', () => {
    expect(calcularRetomada({
      dataInicioPausa: '2026-11-01', dataRetorno: '2026-11-20',
      dataInicioPlano: '2026-11-15', dataFimPlano: '2026-12-14',
    })).toEqual({ dias: 5, novoFim: '2026-12-19' });
  });

  it('pausa inteira antes do ciclo não devolve nada', () => {
    expect(calcularRetomada({
      dataInicioPausa: '2026-11-01', dataRetorno: '2026-11-10',
      dataInicioPlano: '2026-11-15', dataFimPlano: '2026-12-14',
    })).toEqual({ dias: 0, novoFim: '2026-12-14' });
  });

  it('sem data de volta válida, não calcula', () => {
    expect(calcularRetomada({
      dataInicioPausa: '2026-11-15', dataRetorno: '',
      dataInicioPlano: '2026-07-01', dataFimPlano: '2026-12-31',
    })).toBeNull();
  });
});

describe('anexarPausas', () => {
  it('coloca em cada aluno da matrícula só os períodos dele', () => {
    const matriculas = [
      { aula_id: 1, alunos: { id: 7, nome_completo: 'Ana' } },
      { aula_id: 2, alunos: { id: 8, nome_completo: 'Bia' } },
    ];
    const periodos = [{ aluno_id: 7, data_inicio: '2026-11-10', data_retorno: null }];
    const resultado = anexarPausas(matriculas, periodos);
    expect(resultado[0].alunos.pausas).toEqual([{ aluno_id: 7, data_inicio: '2026-11-10', data_retorno: null }]);
    expect(resultado[1].alunos.pausas).toEqual([]);
  });

  it('não quebra com matrícula sem aluno visível (RLS do professor)', () => {
    expect(anexarPausas([{ aula_id: 1, alunos: null }], [])).toEqual([{ aula_id: 1, alunos: null }]);
  });
});

describe('removerFixosEmPausa', () => {
  const fixos = [{ aluno_id: 7 }, { aluno_id: 8 }];
  const periodos = [{ aluno_id: 7, data_inicio: '2026-11-10', data_retorno: '2026-11-20' }];

  it('tira só quem está pausado na data da chamada', () => {
    expect(removerFixosEmPausa(fixos, periodos, '2026-11-15')).toEqual([{ aluno_id: 8 }]);
  });

  it('mantém todos fora das datas da pausa', () => {
    expect(removerFixosEmPausa(fixos, periodos, '2026-11-20')).toEqual(fixos);
  });
});

describe('fixosForaDePausa', () => {
  const HOJE = '2026-11-24';
  const pa = (id, extra = {}) => ({
    id, created_at: `2026-09-0${id.length}T10:00:00Z`, encerrado_em: null, pausado_desde: null, ...extra,
  });
  const fixos = [{ aluno_id: 7 }, { aluno_id: 8 }, { aluno_id: 9 }];

  it('PZ1P: aluno com um plano pausado sai em qualquer modalidade; ausente fica', () => {
    const alunosPorId = new Map([
      [7, { planos_aluno: [pa('A', { pausado_desde: '2026-11-10' })], alunos_modalidades: [] }],
      [8, { planos_aluno: [pa('A')], alunos_modalidades: [] }],
    ]);
    expect([...fixosForaDePausa(fixos, alunosPorId, 'x', HOJE)]).toEqual([8, 9]);
  });

  it('PZ2/PZ3: com dois planos, só sai quem tem o plano da modalidade da aula pausado', () => {
    const A = pa('A');
    const B = pa('BB', { created_at: '2026-10-01T10:00:00Z', pausado_desde: '2026-11-10' });
    const alunosPorId = new Map([[7, {
      planos_aluno: [A, B],
      alunos_modalidades: [{ modalidade_id: 'x', plano_aluno_id: 'A' }, { modalidade_id: 'z', plano_aluno_id: 'BB' }],
    }]]);
    const um = [{ aluno_id: 7 }];
    expect([...fixosForaDePausa(um, alunosPorId, 'x', HOJE)]).toEqual([7]);
    expect([...fixosForaDePausa(um, alunosPorId, 'z', HOJE)]).toEqual([]);
  });

  it('aceita alunosPorId como objeto', () => {
    const alunosPorId = { 7: { planos_aluno: [pa('A', { pausado_desde: '2026-11-10' })], alunos_modalidades: [] } };
    expect([...fixosForaDePausa([{ aluno_id: 7 }], alunosPorId, 'x', HOJE)]).toEqual([]);
  });
});

describe('notificacoesDePausa', () => {
  const pausa = (prevista) => ({
    data_prevista_volta: prevista,
    alunos: { id: 7, nome_completo: 'Ana', ativo: true },
  });

  it('avisa quando a previsão de volta chegou ou passou', () => {
    expect(notificacoesDePausa([pausa('2026-11-04')], '2026-11-04')).toEqual([
      expect.objectContaining({ tipo: 'pausa', dataAlvo: '2026-11-04', diasFaltando: 0 }),
    ]);
    expect(notificacoesDePausa([pausa('2026-11-01')], '2026-11-04')).toEqual([
      expect.objectContaining({ tipo: 'pausa', diasFaltando: -3 }),
    ]);
  });

  it('não avisa antes da previsão', () => {
    expect(notificacoesDePausa([pausa('2026-11-05')], '2026-11-04')).toEqual([]);
  });

  it('ajustar a previsão gera um aviso novo, mesmo já tendo marcado o antigo como resolvido', () => {
    const [antigo] = notificacoesDePausa([pausa('2026-11-01')], '2026-11-04');
    const [novo] = notificacoesDePausa([pausa('2026-11-03')], '2026-11-04');
    expect(novo.idUnico).not.toBe(antigo.idUnico);
  });

  it('N1: uma pausa aberta mantém o id de sempre', () => {
    const [n] = notificacoesDePausa([{ ...pausa('2026-11-20'), plano_aluno_id: 'pa1', planos_aluno: { planos: { nome: 'Mensal' } } }], '2026-11-20');
    expect(n.idUnico).toBe('pausa-7-2026-11-20');
    expect(n.plano).toBeUndefined();
    expect(n.aluno).toEqual({ id: 7, nome_completo: 'Ana', ativo: true });
  });

  it('duas pausas de planos diferentes do mesmo aluno levam o plano no id e no nome', () => {
    const lista = notificacoesDePausa([
      { ...pausa('2026-11-20'), plano_aluno_id: 'pa1', planos_aluno: { planos: { nome: 'Yoga' } } },
      { ...pausa('2026-11-20'), plano_aluno_id: 'pa2', planos_aluno: { planos: { nome: 'Pilates' } } },
    ], '2026-11-20');
    expect(lista.map((n) => n.idUnico)).toEqual(['pausa-7-pa1-2026-11-20', 'pausa-7-pa2-2026-11-20']);
    expect(lista.map((n) => n.aluno.planos.nome)).toEqual(['Yoga', 'Pilates']);
    expect(lista.map((n) => n.plano)).toEqual(['Yoga', 'Pilates']);
  });

  it('ignora aluno desativado', () => {
    const desativado = { data_prevista_volta: '2026-11-01', alunos: { id: 7, nome_completo: 'Ana', ativo: false } };
    expect(notificacoesDePausa([desativado], '2026-11-04')).toEqual([]);
  });
});

describe('cobrancasRemoviveis', () => {
  it('deixa de fora a integral de um ciclo à vista', () => {
    const mensal = { id: 1, descricao: null };
    const integral = { id: 2, descricao: 'Pagamento integral do plano' };
    expect(cobrancasRemoviveis([mensal, integral])).toEqual([mensal]);
  });
});

describe('diasDevolvidosNoCiclo', () => {
  const pausas = [
    { historico_plano_id: 'c1', dias_devolvidos: 10 },
    { historico_plano_id: 'c1', dias_devolvidos: 5 },
    { historico_plano_id: 'c2', dias_devolvidos: 7 },
    { historico_plano_id: 'c1', dias_devolvidos: null },
  ];

  it('soma só os dias já devolvidos ao ciclo informado', () => {
    expect(diasDevolvidosNoCiclo(pausas, 'c1')).toBe(15);
  });

  it('sem pausas, zero', () => {
    expect(diasDevolvidosNoCiclo(undefined, 'c1')).toBe(0);
  });
});

// ILU-127 (entrega 4): a pausa de um plano só esconde as aulas fixas desse plano.
describe('pausa por plano: aula_ids', () => {
  const pausaB = { aluno_id: 1, data_inicio: '2026-11-10', data_retorno: null, plano_aluno_id: 22, aula_ids: [30] };

  it('removerFixosEmPausa mantém o fixo de outro plano do mesmo aluno', () => {
    const fixos = [{ aluno_id: 1, aula_id: 20 }, { aluno_id: 1, aula_id: 30 }];
    expect(removerFixosEmPausa(fixos, [pausaB], '2026-11-15')).toEqual([{ aluno_id: 1, aula_id: 20 }]);
  });

  it('compara ids como número, venham como texto ou número', () => {
    const fixos = [{ aluno_id: 1, aula_id: '30' }, { aluno_id: 1, aula_id: 20 }];
    const periodo = { ...pausaB, aula_ids: ['30'] };
    expect(removerFixosEmPausa(fixos, [periodo], '2026-11-15')).toEqual([{ aluno_id: 1, aula_id: 20 }]);
  });

  it('aula_ids vazio não pausa nenhum fixo', () => {
    const fixos = [{ aluno_id: 1, aula_id: 20 }];
    expect(removerFixosEmPausa(fixos, [{ ...pausaB, aula_ids: [] }], '2026-11-15')).toEqual(fixos);
  });

  it('sem aula_ids, vale para todos os fixos do aluno', () => {
    const antigo = { ...pausaB }; delete antigo.aula_ids;
    const fixos = [{ aluno_id: 1, aula_id: 20 }, { aluno_id: 1, aula_id: 30 }];
    expect(removerFixosEmPausa(fixos, [antigo], '2026-11-15')).toEqual([]);
  });

  it('anexarPausas só anexa à matrícula da aula do plano pausado', () => {
    const matriculas = [
      { aula_id: 20, alunos: { id: 1 } },
      { aula_id: 30, alunos: { id: 1 } },
    ];
    const r = anexarPausas(matriculas, [pausaB]);
    expect(r[0].alunos.pausas).toEqual([]);
    expect(r[1].alunos.pausas).toEqual([pausaB]);
  });

  it('anexarPausas sem aula_ids anexa a todas, como antes', () => {
    const antigo = { ...pausaB }; delete antigo.aula_ids;
    const r = anexarPausas([{ aula_id: 20, alunos: { id: 1 } }], [antigo]);
    expect(r[0].alunos.pausas).toEqual([antigo]);
  });
});
