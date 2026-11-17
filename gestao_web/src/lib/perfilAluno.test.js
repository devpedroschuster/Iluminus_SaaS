import { describe, it, expect } from 'vitest';
import {
  montarAtualizacaoPerfil, validarArquivoAvatar, caminhoAvatar, caminhoDoAvatarSalvo, AVATAR_MAX_BYTES,
} from './perfilAluno';

const HOJE = '2026-11-17';
const CPF_VALIDO = '52998224725';

describe('montarAtualizacaoPerfil (ILU-84)', () => {
  it('troca campos vazios por null — a data vazia fazia o Postgres recusar (22007)', () => {
    expect(montarAtualizacaoPerfil({ telefone: '51 99999-8888', cpf: '', data_nascimento: '' }, HOJE)).toEqual({
      dados: { telefone: '51999998888', cpf: null, data_nascimento: null },
    });
  });

  it('grava telefone e CPF só com dígitos', () => {
    expect(montarAtualizacaoPerfil({ telefone: '(51) 3333-4444', cpf: '529.982.247-25', data_nascimento: '1990-05-20' }, HOJE)).toEqual({
      dados: { telefone: '5133334444', cpf: CPF_VALIDO, data_nascimento: '1990-05-20' },
    });
  });

  it('aceita valores ausentes', () => {
    expect(montarAtualizacaoPerfil({ telefone: null, cpf: undefined, data_nascimento: null }, HOJE)).toEqual({
      dados: { telefone: null, cpf: null, data_nascimento: null },
    });
  });

  it('recusa telefone sem DDD ou longo demais', () => {
    expect(montarAtualizacaoPerfil({ telefone: '99998888' }, HOJE).erro).toMatch(/Telefone/);
    expect(montarAtualizacaoPerfil({ telefone: '519999988887' }, HOJE).erro).toMatch(/Telefone/);
  });

  it('recusa CPF inválido', () => {
    expect(montarAtualizacaoPerfil({ cpf: '111.111.111-11' }, HOJE).erro).toMatch(/CPF/);
    expect(montarAtualizacaoPerfil({ cpf: '52998224724' }, HOJE).erro).toMatch(/CPF/);
  });

  it('recusa data de nascimento no futuro ou fora do formato', () => {
    expect(montarAtualizacaoPerfil({ data_nascimento: '2026-11-18' }, HOJE).erro).toMatch(/nascimento/);
    expect(montarAtualizacaoPerfil({ data_nascimento: '20/05/1990' }, HOJE).erro).toMatch(/nascimento/);
    expect(montarAtualizacaoPerfil({ data_nascimento: '1850-01-01' }, HOJE).erro).toMatch(/nascimento/);
    expect(montarAtualizacaoPerfil({ data_nascimento: HOJE }, HOJE).dados.data_nascimento).toBe(HOJE);
  });
});

describe('foto de perfil (ILU-85/ILU-44)', () => {
  it('aceita JPG, PNG e WEBP até 2 MB', () => {
    expect(validarArquivoAvatar({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validarArquivoAvatar({ type: 'image/webp', size: AVATAR_MAX_BYTES })).toBeNull();
  });

  it('recusa outros tipos, arquivos grandes e ausência de arquivo', () => {
    expect(validarArquivoAvatar({ type: 'image/gif', size: 10 })).toMatch(/JPG/);
    expect(validarArquivoAvatar({ type: 'application/pdf', size: 10 })).toMatch(/JPG/);
    expect(validarArquivoAvatar({ type: 'image/jpeg', size: AVATAR_MAX_BYTES + 1 })).toMatch(/2 MB/);
    expect(validarArquivoAvatar(undefined)).toMatch(/Nenhuma/);
  });

  it('monta o caminho dentro da pasta do login, com a extensão pelo tipo', () => {
    expect(caminhoAvatar('abc-123', { type: 'image/jpeg', name: 'foto.JPEG.exe' }, 42)).toBe('abc-123/42.jpg');
  });

  it('extrai o caminho da foto salva só se for da pasta da própria pessoa', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/avatars/abc-123/42.jpg';
    expect(caminhoDoAvatarSalvo(url, 'abc-123')).toBe('abc-123/42.jpg');
    expect(caminhoDoAvatarSalvo(`${url}?t=1`, 'abc-123')).toBe('abc-123/42.jpg');
    expect(caminhoDoAvatarSalvo(url, 'outro')).toBeNull();
    expect(caminhoDoAvatarSalvo('https://x.supabase.co/storage/v1/object/public/avatars/10-1773892190637.png', 'abc-123')).toBeNull();
    expect(caminhoDoAvatarSalvo(null, 'abc-123')).toBeNull();
  });
});
