// Dia da semana tolerante: o banco tem `agenda.dia_semana` gravado de vários
// jeitos ("Qui", "quinta", "Quinta-feira", com e sem acento). Usado pelo
// perfil da aluna (turmas fixas) e pela busca de aluno na Agenda.

// Nome canônico (completo) de cada dia, indexado por ordem 0-6
export const DIAS_CANONICOS = [
  'Domingo', 'Segunda-feira', 'Terça-feira',
  'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado',
];

// Remove acentos e deixa minúsculo, para comparação tolerante
export function semAcento(str) {
  return String(str ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Todas as variações conhecidas (nome completo, abreviação, com/sem hífen,
// com/sem acento) → índice do dia (0=Domingo ... 6=Sábado)
const MAPA_DIA = {
  domingo: 0, dom: 0,
  'segunda-feira': 1, 'segunda feira': 1, segunda: 1, seg: 1,
  'terca-feira': 2, 'terca feira': 2, terca: 2, ter: 2,
  'quarta-feira': 3, 'quarta feira': 3, quarta: 3, qua: 3,
  'quinta-feira': 4, 'quinta feira': 4, quinta: 4, qui: 4,
  'sexta-feira': 5, 'sexta feira': 5, sexta: 5, sex: 5,
  sabado: 6, sab: 6,
};

// Recebe qualquer variação salva no banco e devolve o nome canônico completo
// (ex.: "Qui", "quinta", "Quinta-Feira" → "Quinta-feira")
export function normalizarDiaSemana(valor) {
  const idx = MAPA_DIA[semAcento(valor)];
  return idx !== undefined ? DIAS_CANONICOS[idx] : (valor || 'Dia não definido');
}

// 0=domingo ... 6=sábado; 99 quando o valor não é reconhecido
export function ordemDiaSemana(valor) {
  const idx = MAPA_DIA[semAcento(valor)];
  return idx !== undefined ? idx : 99;
}
