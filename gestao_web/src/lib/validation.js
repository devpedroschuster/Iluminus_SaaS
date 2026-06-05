import * as yup from 'yup';
import { validarCPF } from '../lib/utils';

export const alunoSchema = yup.object().shape({
  nome_completo: yup.string().required('O nome completo é obrigatório.'),
  email: yup.string().email('Insira um e-mail válido.').required('O e-mail é obrigatório.'),
  cpf: yup.string()
  .nullable()
  .optional()
  .test('cpf-valido', 'CPF inválido. Verifique os dígitos.', (value) => {
    if (!value) return true;
    return validarCPF(value);
  }),
  role: yup.string().oneOf(['aluno', 'admin']).default('aluno'),
  plano_id: yup.string().nullable().optional(),
  data_nascimento: yup.string().nullable().optional(),
  telefone: yup.string().nullable().optional(),
  cep: yup.string().nullable().optional(),
  rua: yup.string().nullable().optional(),
  numero: yup.string().nullable().optional(),
  bairro: yup.string().nullable().optional(),
});