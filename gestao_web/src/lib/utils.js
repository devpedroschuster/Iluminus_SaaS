/**
 * Valor que uma mensalidade representa, considerando o congelamento do
 * ILU-29: `valor_pago` só é preenchido por ação explícita (pagamento
 * confirmado ou lançamento manual), nunca derivado automaticamente — por
 * isso ele vale independente do `status`. Na ausência dele, usa o
 * `valor_esperado` congelado no momento da criação da mensalidade (imune a
 * edições posteriores no preço do plano) e só cai para o preço vigente do
 * plano em linhas legadas que ainda não têm esse campo.
 */
export const valorDevidoMensalidade = (mensalidade) => {
  if (!mensalidade) return 0;
  if (mensalidade.valor_pago != null) return Number(mensalidade.valor_pago);
  return Number(mensalidade.valor_esperado ?? mensalidade.planos?.preco ?? 0);
};

export const formatarMoeda = (valor) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor || 0);
};

/**
 * Converte uma string em formato brasileiro (ex.: "1.500,90") para número.
 * Contraparte de `formatarValorInput` — os campos de valor pago sempre
 * pré-preenchem via `formatarValorInput`, então o texto chega aqui sempre
 * no mesmo formato, mesmo quando o usuário não edita o campo (ILU-28).
 */
export const parseValorMoeda = (texto) => {
  return parseFloat(String(texto ?? '').replace(/\./g, '').replace(',', '.'));
};

/**
 * Formata um número para exibição em um campo de texto editável (sem o
 * prefixo "R$" de `formatarMoeda`), sempre em formato brasileiro — para que
 * o texto pré-preenchido seja compatível com o parse de `parseValorMoeda`.
 */
export const formatarValorInput = (valor) => {
  if (valor == null || valor === '') return '';
  return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const formatarData = (data, comHora = false) => {
  if (!data) return '-';
  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo'
  };
  if (comHora) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  const dataSegura = typeof data === 'string' && data.length === 10
    ? data + 'T12:00:00'
    : data;
  return new Intl.DateTimeFormat('pt-BR', options).format(new Date(dataSegura));
};

export const paraUTC = (ano, mes, dia = 1) => {
  return new Date(Date.UTC(ano, mes, dia)).toISOString().split('T')[0];
};

/**
 * Data de "hoje" no formato 'AAAA-MM-DD', calculada no fuso de Brasília
 * (America/Sao_Paulo) em vez de UTC (ILU-19). `new Date().toISOString()`
 * sempre usa UTC — como o Brasil é UTC-3, entre ~21h e meia-noite no
 * horário de Brasília a data-calendário em UTC já virou o dia seguinte,
 * fazendo comparações/gravações de "hoje" errarem por um dia nesse
 * intervalo (vencimento marcado como atrasado cedo demais, data de
 * matrícula/pagamento gravada com um dia a mais, etc).
 */
export const hojeBrasilia = () => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day}`;
};

/**
 * Soma um mês de calendário a uma data 'AAAA-MM-DD', preservando o dia
 * quando possível (ex.: 2026-01-15 → 2026-02-15) e recuando para o último
 * dia do mês de destino quando o dia original não existir nele (ex.:
 * 2026-01-31 → 2026-02-28) — mesmo approach usado em
 * despesasService.replicarRecorrentes. Evita o desvio de "+30 dias fixos"
 * (ILU-17), que desalinha com o calendário real (meses têm 28-31 dias) e
 * pode pular um mês inteiro para vencimentos perto do fim do mês.
 */
export const avancarUmMes = (dataStr) => {
  const d = new Date(dataStr + 'T12:00:00');
  const dia = d.getDate();
  const mesAlvo = d.getMonth() + 1; // 0-indexed; pode "estourar" para 12 (Date normaliza para janeiro do ano seguinte)
  const proxima = new Date(d.getFullYear(), mesAlvo, dia, 12);
  if (proxima.getMonth() !== mesAlvo % 12) {
    proxima.setDate(0); // recua para o último dia do mês de destino
  }
  return proxima.toISOString().split('T')[0];
};

export const validarEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

export const validarCPF = (cpf) => {
  cpf = cpf.replace(/[^\d]/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  let resto;
  for (let i = 1; i <= 9; i++) {
    soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(9, 10))) return false;
  soma = 0;
  for (let i = 1; i <= 10; i++) {
    soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(10, 11))) return false;
  return true;
};

export const formatarCPF = (cpf) => {
  if (!cpf) return '';
  cpf = cpf.replace(/\D/g, '');
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

export const formatarTelefone = (telefone) => {
  if (!telefone) return '';
  telefone = telefone.replace(/\D/g, '');
  if (telefone.length === 11) {
    return telefone.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  return telefone.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
};

export const coresStatus = {
  pago:     { bg: 'bg-success-soft', text: 'text-success' },
  pendente: { bg: 'bg-warning-soft', text: 'text-warning' },
  atrasado: { bg: 'bg-destructive-soft', text: 'text-destructive' },
  ativo:    { bg: 'bg-success-soft', text: 'text-success' },
  inativo:  { bg: 'bg-muted', text: 'text-muted-foreground' },
};