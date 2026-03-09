// Dentro do seu arquivo validation.js
import * as yup from 'yup';

export const alunoSchema = yup.object().shape({
  nome_completo: yup.string().required('Nome é obrigatório'),
  email: yup.string().email('E-mail inválido').required('E-mail é obrigatório'),
  role: yup.string().required('Cargo é obrigatório'),
  plano_id: yup.string().nullable(),
  cpf: yup.string().required('CPF é obrigatório'),
  data_nascimento: yup.string().nullable(),
  telefone: yup.string().nullable(),
  cep: yup.string().nullable(),
  rua: yup.string().nullable(),
  numero: yup.string().nullable(),
  bairro: yup.string().nullable(),
});