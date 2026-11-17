import { validarCPF } from './utils';

// Perfil da Área do Aluno (ILU-84): o que o aluno edita no próprio cadastro.
// Telefone e CPF são gravados só com dígitos (como a maioria dos cadastros e o
// NovoAluno); campo vazio vira null — o Postgres recusa '' numa coluna date
// (22007), e era isso que fazia o "Salvar" falhar para quem não tinha data de
// nascimento cadastrada.
// `hoje` é 'AAAA-MM-DD' (hojeBrasilia()).
export function montarAtualizacaoPerfil({ telefone, cpf, data_nascimento } = {}, hoje) {
  const fone = String(telefone ?? '').replace(/\D/g, '');
  const doc = String(cpf ?? '').replace(/\D/g, '');
  const nascimento = String(data_nascimento ?? '').trim();

  if (fone && (fone.length < 10 || fone.length > 11)) {
    return { erro: 'Telefone inválido. Informe o DDD e o número.' };
  }
  if (doc && !validarCPF(doc)) {
    return { erro: 'CPF inválido. Verifique os dígitos.' };
  }
  if (nascimento) {
    const formatoValido = /^\d{4}-\d{2}-\d{2}$/.test(nascimento)
      && !Number.isNaN(Date.parse(`${nascimento}T12:00:00Z`));
    if (!formatoValido || nascimento < '1900-01-01' || (hoje && nascimento > hoje)) {
      return { erro: 'Data de nascimento inválida.' };
    }
  }

  return {
    dados: {
      telefone: fone || null,
      cpf: doc || null,
      data_nascimento: nascimento || null,
    },
  };
}

// Foto de perfil (ILU-85/ILU-44). O bucket `avatars` tem os mesmos limites; a
// checagem aqui só dá uma mensagem clara antes do envio.
export const AVATAR_TIPOS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export function validarArquivoAvatar(arquivo) {
  if (!arquivo) return 'Nenhuma imagem selecionada.';
  if (!AVATAR_TIPOS[arquivo.type]) return 'Envie uma foto em JPG, PNG ou WEBP.';
  if (arquivo.size > AVATAR_MAX_BYTES) return 'A foto deve ter no máximo 2 MB.';
  return null;
}

// Cada pessoa só grava dentro da própria pasta (`<auth_id>/...`) — é o que as
// policies do bucket exigem.
export function caminhoAvatar(authId, arquivo, agora = Date.now()) {
  return `${authId}/${agora}.${AVATAR_TIPOS[arquivo.type]}`;
}

// Caminho dentro do bucket a partir da URL pública salva em `avatar_url`, para
// apagar a foto anterior. Só devolve caminhos da pasta da própria pessoa.
export function caminhoDoAvatarSalvo(avatarUrl, authId) {
  if (!avatarUrl || !authId) return null;
  const marcador = '/storage/v1/object/public/avatars/';
  const inicio = avatarUrl.indexOf(marcador);
  if (inicio === -1) return null;
  const caminho = decodeURIComponent(avatarUrl.slice(inicio + marcador.length).split('?')[0]);
  return caminho.startsWith(`${authId}/`) ? caminho : null;
}
