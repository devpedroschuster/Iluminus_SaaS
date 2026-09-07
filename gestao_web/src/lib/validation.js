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
  bolsista: yup.boolean().default(false),
  data_nascimento: yup.string().nullable().optional(),
  telefone: yup.string().nullable().optional(),
  cep: yup.string().nullable().optional(),
  rua: yup.string().nullable().optional(),
  numero: yup.string().nullable().optional(),
  bairro: yup.string().nullable().optional(),
});

// ILU-25: planosService.salvar alimenta cobrança recorrente de mensalidades —
// preço e duração precisam ser números válidos e positivos.
export const planoSchema = yup.object().shape({
  nome: yup.string().trim().required('O nome do plano é obrigatório.'),
  preco: yup.number()
    .typeError('Informe um preço válido.')
    .required('O preço é obrigatório.')
    .min(0, 'O preço não pode ser negativo.'),
  duracao_meses: yup.number()
    .typeError('Informe uma duração válida.')
    .required('A duração é obrigatória.')
    .integer('A duração deve ser um número inteiro de meses.')
    .min(1, 'A duração deve ser de pelo menos 1 mês.'),
});

// ILU-25: as 3 taxas de modalidadeService.salvar alimentam diretamente o
// cálculo de repasse na Edge Function gerar-repasses — cada uma precisa
// estar entre 0-100%, e a soma das três deve fechar em 100%.
export const modalidadeSchema = yup.object().shape({
  nome: yup.string().trim().required('O nome da modalidade é obrigatório.'),
  taxa_professor: yup.number()
    .typeError('Taxa do professor inválida.')
    .required()
    .min(0, 'A taxa do professor não pode ser negativa.')
    .max(100, 'A taxa do professor não pode passar de 100%.'),
  taxa_espaco: yup.number()
    .typeError('Taxa do espaço inválida.')
    .required()
    .min(0, 'A taxa do espaço não pode ser negativa.')
    .max(100, 'A taxa do espaço não pode passar de 100%.'),
  taxa_direcao: yup.number()
    .typeError('Taxa da direção inválida.')
    .required()
    .min(0, 'A taxa da direção não pode ser negativa.')
    .max(100, 'A taxa da direção não pode passar de 100%.'),
}).test(
  'soma-taxas-100',
  'A soma das taxas de professor, espaço e direção deve ser 100%.',
  (valores) => {
    if (!valores) return true;
    const soma = Number(valores.taxa_professor || 0) + Number(valores.taxa_espaco || 0) + Number(valores.taxa_direcao || 0);
    return Math.abs(soma - 100) < 0.01;
  }
);

// ILU-25: despesasService.salvar não validava valor/data_vencimento.
export const despesaSchema = yup.object().shape({
  descricao: yup.string().trim().required('A descrição é obrigatória.'),
  valor: yup.number()
    .typeError('Informe um valor válido.')
    .required('O valor é obrigatório.')
    .moreThan(0, 'O valor deve ser maior que zero.'),
  data_vencimento: yup.string()
    .required('A data de vencimento é obrigatória.')
    .matches(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento inválida.'),
});

// ILU-25: professoresService.salvar não validava formato de e-mail antes do insert.
export const professorSchema = yup.object().shape({
  nome: yup.string().trim().required('O nome é obrigatório.'),
  email: yup.string().nullable().optional().email('Insira um e-mail válido.'),
});