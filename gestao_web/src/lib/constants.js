// src/lib/constants.js

/**
 * CONSTANTES GLOBAIS DO ESPAÇO ILUMINUS
 */

// Cores do tema
export const CORES = {
  terracota: '#D98E73',
  texto: '#2D2D2D',
  fundo: '#FDF8F5',
  verde: '#8A9A5B',
  bege: '#F0E5DE',
};

// Status de mensalidades
export const STATUS_MENSALIDADE = {
  PAGO: 'pago',
  PENDENTE: 'pendente',
  ATRASADO: 'atrasado',
};

// Roles de usuário
export const ROLES = {
  ADMIN: 'admin',
  PROFESSOR: 'professor',
  ALUNO: 'aluno',
};

// Dias da semana
export const DIAS_SEMANA = [
  { valor: 'segunda-feira', label: 'Segunda-feira', abrev: 'Seg' },
  { valor: 'terça-feira', label: 'Terça-feira', abrev: 'Ter' },
  { valor: 'quarta-feira', label: 'Quarta-feira', abrev: 'Qua' },
  { valor: 'quinta-feira', label: 'Quinta-feira', abrev: 'Qui' },
  { valor: 'sexta-feira', label: 'Sexta-feira', abrev: 'Sex' },
  { valor: 'sábado', label: 'Sábado', abrev: 'Sáb' },
  { valor: 'domingo', label: 'Domingo', abrev: 'Dom' },
];

// Configurações de paginação
export const PAGINACAO = {
  ITENS_POR_PAGINA: 20,
  ITENS_POR_PAGINA_MOBILE: 10,
};

// Limites de campos
export const LIMITES = {
  NOME_MIN: 3,
  NOME_MAX: 100,
  SENHA_MIN: 6,
  CAPACIDADE_AULA_MIN: 1,
  CAPACIDADE_AULA_MAX: 50,
  VALOR_PLANO_MIN: 0,
  VALOR_PLANO_MAX: 10000,
};

// Mensagens padrão
export const MENSAGENS = {
  erro: {
    generico: 'Ocorreu um erro inesperado. Tente novamente.',
    semPermissao: 'Você não tem permissão para realizar esta ação.',
    naoAutenticado: 'Você precisa estar autenticado.',
    camposObrigatorios: 'Preencha todos os campos obrigatórios.',
    emailInvalido: 'Digite um email válido.',
    senhaFraca: 'A senha deve ter no mínimo 6 caracteres.',
  },
  sucesso: {
    cadastrado: 'Cadastrado com sucesso!',
    atualizado: 'Atualizado com sucesso!',
    excluido: 'Excluído com sucesso!',
    salvo: 'Salvo com sucesso!',
  },
};

// Configurações de data
export const CONFIG_DATA = {
  FORMATO_BR: 'DD/MM/YYYY',
  FORMATO_ISO: 'YYYY-MM-DD',
  TIMEZONE: 'America/Sao_Paulo',
  DIA_VENCIMENTO_PADRAO: 10,
};

// Endpoints da API (se houver)
export const API_ENDPOINTS = {
  // No Vite, usamos import.meta.env em vez de process.env
  BASE_URL: import.meta.env.VITE_API_URL || '',
};

// Validação
export const REGEX = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  TELEFONE: /^\(\d{2}\)\s\d{4,5}-\d{4}$/,
  CPF: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/,
  APENAS_NUMEROS: /^\d+$/,
};

// Links úteis
export const LINKS = {
  SUPORTE: 'mailto:suporte@espacoiluminus.com',
  DOCUMENTACAO: '/docs',
  TERMOS: '/termos-de-uso',
  PRIVACIDADE: '/politica-privacidade',
};

// Mapeamento de ícones por tipo
export const ICONES_STATUS = {
  ativo: 'CheckCircle',
  inativo: 'XCircle',
  pendente: 'Clock',
  pago: 'CheckCircle',
  atrasado: 'AlertCircle',
};

// Configurações de gráficos
export const CORES_GRAFICOS = ['#D98E73', '#8A9A5B', '#F0E5DE', '#2D2D2D'];

export default {
  CORES,
  STATUS_MENSALIDADE,
  ROLES,
  DIAS_SEMANA,
  PAGINACAO,
  LIMITES,
  MENSAGENS,
  CONFIG_DATA,
  API_ENDPOINTS,
  REGEX,
  LINKS,
  ICONES_STATUS,
  CORES_GRAFICOS,
};
