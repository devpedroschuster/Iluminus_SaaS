import * as yup from 'yup';

export const alunoSchema = yup.object({
  nome_completo: yup.string()
    .required('O nome completo é obrigatório')
    .min(3, 'O nome deve ter pelo menos 3 caracteres'),
  
  email: yup.string()
    .required('O e-mail é obrigatório')
    .email('Digite um e-mail válido'),
  
  role: yup.string()
    .required('Selecione um cargo'),
  
  plano_id: yup.string()
    .when('role', {
      is: 'aluno',
      then: (schema) => schema.required('Alunos precisam de um plano vinculado'),
      otherwise: (schema) => schema.nullable()
    })
});