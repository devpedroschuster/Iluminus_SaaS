// src/lib/utils.js

/**
 * Formatação de Moeda Brasileira
 */
export const formatarMoeda = (valor) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor || 0);
};

/**
 * Formatação de Data Brasileira
 */
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
  
  return new Intl.DateTimeFormat('pt-BR', options).format(new Date(data));
};

/**
 * Converte data para formato ISO YYYY-MM-DD em UTC
 * CORREÇÃO: Removemos o 'mes - 1' pois os inputs do Date.getMonth() já vêm de 0 a 11.
 * Ex: Janeiro = 0. Date.UTC(2025, 0, 1) gera 01/01/2025.
 */
export const paraUTC = (ano, mes, dia = 1) => {
  return new Date(Date.UTC(ano, mes, dia)).toISOString().split('T')[0];
};

/**
 * Validação de Email
 */
export const validarEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

/**
 * Validação de CPF
 */
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

/**
 * Formatação de CPF
 */
export const formatarCPF = (cpf) => {
  if (!cpf) return '';
  cpf = cpf.replace(/\D/g, '');
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

/**
 * Formatação de Telefone
 */
export const formatarTelefone = (telefone) => {
  if (!telefone) return '';
  telefone = telefone.replace(/\D/g, '');
  
  if (telefone.length === 11) {
    return telefone.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  
  return telefone.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
};

/**
 * Cores de status (Usado no Dashboard e Despesas)
 */
export const coresStatus = {
  pago: { bg: 'bg-green-100', text: 'text-green-700' },
  pendente: { bg: 'bg-orange-100', text: 'text-orange-700' },
  atrasado: { bg: 'bg-red-100', text: 'text-red-700' },
  ativo: { bg: 'bg-green-100', text: 'text-green-700' },
  inativo: { bg: 'bg-gray-100', text: 'text-gray-600' }
};