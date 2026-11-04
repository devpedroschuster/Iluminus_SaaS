import { describe, it, expect } from 'vitest';
import {
  emPausaNaData, calcularRetomada, anexarPausas, removerFixosEmPausa, fixosForaDePausa,
  notificacoesDePausa, cobrancasRemoviveis, diasDevolvidosNoCiclo,
} from './pausaPlano';

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
  it('monta o conjunto de fixos da aula sem quem está com o plano pausado', () => {
    const conjunto = fixosForaDePausa([
      { aluno_id: 7, alunos: { plano_pausado_desde: '2026-11-10' } },
      { aluno_id: 8, alunos: { plano_pausado_desde: null } },
      { aluno_id: 9, alunos: null },
    ]);
    expect([...conjunto]).toEqual([8, 9]);
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
