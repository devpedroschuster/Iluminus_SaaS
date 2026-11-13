import { hojeBrasilia, valorDevidoMensalidade, parseValorMoeda, formatarValorInput } from './utils';

const MS_POR_DIA = 86_400_000;

// Diferença em dias entre duas datas 'AAAA-MM-DD' (meio-dia evita virada de fuso).
const diasEntre = (inicio, fim) =>
  Math.round((new Date(`${fim}T12:00:00`) - new Date(`${inicio}T12:00:00`)) / MS_POR_DIA);

/**
 * Deriva o status de exibição de uma mensalidade. O banco só guarda
 * 'pago' | 'pendente'; "atrasado" é calculado comparando o vencimento com
 * `hoje` (strings 'AAAA-MM-DD', fuso de Brasília).
 */
export function calcularStatusReal(item, hoje = hojeBrasilia()) {
  if (item.status === 'pago') return { tipo: 'pago', diasAtraso: 0 };
  if (item.data_vencimento < hoje) {
    return { tipo: 'atrasado', diasAtraso: diasEntre(item.data_vencimento, hoje) };
  }
  return { tipo: 'pendente', diasAtraso: 0 };
}

export const ORDEM_STATUS = { atrasado: 0, pendente: 1, pago: 2 };

/**
 * Atrasados (mais antigos no topo) → pendentes (vencimento mais próximo) →
 * pagos (pagamento mais recente primeiro). Devolve uma lista nova.
 */
export function ordenarMensalidades(lista, hoje = hojeBrasilia()) {
  return [...lista].sort((a, b) => {
    const sa = calcularStatusReal(a, hoje);
    const sb = calcularStatusReal(b, hoje);
    const diff = ORDEM_STATUS[sa.tipo] - ORDEM_STATUS[sb.tipo];
    if (diff !== 0) return diff;
    if (sa.tipo === 'atrasado') return sb.diasAtraso - sa.diasAtraso;
    if (sa.tipo === 'pago') {
      const dA = a.data_pagamento || a.data_vencimento || '';
      const dB = b.data_pagamento || b.data_vencimento || '';
      return dB.localeCompare(dA);
    }
    return (a.data_vencimento || '').localeCompare(b.data_vencimento || '');
  });
}

/** Filtro: 'todos' | 'atrasado' | 'pendente' | 'pago' | 'em_aberto' (atrasado + pendente). */
export function filtrarPorStatus(lista, filtro, hoje = hojeBrasilia()) {
  if (filtro === 'todos') return [...lista];
  return lista.filter((item) => {
    const { tipo } = calcularStatusReal(item, hoje);
    return filtro === 'em_aberto' ? tipo !== 'pago' : tipo === filtro;
  });
}

/** Totais para os cartões do topo da aba Financeiro do aluno. */
export function resumoFinanceiroAluno(lista, hoje = hojeBrasilia()) {
  const ano = Number(hoje.slice(0, 4));
  const resumo = {
    emAberto: { total: 0, quantidade: 0 },
    pagoNoAno: { ano, total: 0, quantidade: 0 },
    ultimoPagamento: null,
  };
  for (const item of lista) {
    if (item.status !== 'pago') {
      resumo.emAberto.total += valorDevidoMensalidade(item);
      resumo.emAberto.quantidade += 1;
      continue;
    }
    if (!item.data_pagamento) continue;
    if (item.data_pagamento.startsWith(`${ano}-`)) {
      resumo.pagoNoAno.total += valorDevidoMensalidade(item);
      resumo.pagoNoAno.quantidade += 1;
    }
    if (!resumo.ultimoPagamento || item.data_pagamento > resumo.ultimoPagamento.data) {
      resumo.ultimoPagamento = { data: item.data_pagamento, forma: item.forma_pagamento };
    }
  }
  return resumo;
}

const ROTULOS_REFERENCIA = {
  plano_livre: 'Plano livre',
  avulsa: 'Avulsa',
  experimental: 'Experimental',
  produto: 'Produto',
  evento: 'Evento',
};

/** Rótulo da coluna "Referência"; `null` para `regular` (quem chama mostra a modalidade). */
export const rotuloReferencia = (item) => ROTULOS_REFERENCIA[item.tipo_aula] ?? null;

const TIPOS_FIXOS_AO_RECEBER = ['experimental', 'avulsa', 'produto', 'evento'];

/** Tipo de aula que vai para a confirmação do pagamento. */
export function tipoAulaAoReceber(mensalidade) {
  if (TIPOS_FIXOS_AO_RECEBER.includes(mensalidade.tipo_aula)) return mensalidade.tipo_aula;
  return mensalidade.planos?.is_plano_livre ? 'plano_livre' : 'regular';
}

const estaPaga = (item) => item.status === 'pago';

/** Valores iniciais do formulário de edição de uma cobrança. */
export function formEdicaoInicial(item) {
  const valor = estaPaga(item) ? item.valor_pago : valorDevidoMensalidade(item);
  return {
    data_vencimento: item.data_vencimento || '',
    valor: formatarValorInput(valor),
    forma_pagamento: item.forma_pagamento || '',
    data_pagamento: item.data_pagamento || '',
    modalidade_id: item.modalidade_id || '',
  };
}

/** Payload do UPDATE da edição. Nunca inclui `status`; a modalidade só vale em `regular`. */
export function montarPayloadEdicao(item, form) {
  const modalidade_id = item.tipo_aula === 'regular' ? (form.modalidade_id || null) : null;
  const valor = parseValorMoeda(form.valor);
  if (estaPaga(item)) {
    return {
      data_vencimento: form.data_vencimento,
      valor_pago: valor,
      forma_pagamento: form.forma_pagamento || null,
      data_pagamento: form.data_pagamento || null,
      modalidade_id,
    };
  }
  return {
    data_vencimento: form.data_vencimento,
    valor_esperado: valor,
    valor_pago: null,
    modalidade_id,
  };
}

/** Comissão de mês já fechado vem desmarcada por padrão. */
export const comissaoMarcadaPorPadrao = (comissao) => !comissao.mes_fechado;

/** '2026-08-01' → 'agosto/2026'. */
export function rotuloMesReferencia(data) {
  const d = new Date(`${data.slice(0, 7)}-01T12:00:00`);
  return `${d.toLocaleString('pt-BR', { month: 'long' })}/${d.getFullYear()}`;
}

// Também as consultas da tela Comissões: receber, reverter e excluir mudam
// os repasses dos professores.
export const CONSULTAS_FINANCEIRAS = [
  ['financeiro'],
  ['financeiro-aluno'],
  ['aluno-cobrancas-em-aberto'],
  ['dashboard'],
  ['comissoes'],
  ['resumo-mensal'],
  ['repasses'],
];

export function invalidarConsultasFinanceiras(queryClient) {
  CONSULTAS_FINANCEIRAS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

export class ErroLancamento extends Error {}

const MENSAGEM_GENERICA = 'Não foi possível concluir a operação. Tente de novo.';

/** Mensagem para o usuário: textos de RAISE (P0001) e ErroLancamento passam; o resto vira genérica. */
export function mensagemErroLancamento(error) {
  if (error instanceof ErroLancamento || error?.code === 'P0001') return error.message;
  return MENSAGEM_GENERICA;
}
