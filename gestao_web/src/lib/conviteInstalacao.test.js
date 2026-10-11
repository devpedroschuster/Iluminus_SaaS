import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ILU-81: o convite de instalação do Chrome (beforeinstallprompt) chega uma vez
// por carregamento, muitas vezes antes de a tela que mostra o botão montar. O
// main.jsx o guardava em window e o usePWA nunca lia: quem montava depois do
// evento ficava sem botão "Instalar".

let convite;

beforeEach(async () => {
  vi.resetModules();
  convite = await import('./conviteInstalacao');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function criarEvento(outcome = 'accepted') {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  };
}

describe('convite de instalação (regressão ILU-81)', () => {
  it('o convite que chegou antes de alguém ouvir continua disponível', () => {
    const evento = criarEvento();
    convite.guardarConvite(evento);

    expect(evento.preventDefault).toHaveBeenCalled();
    expect(convite.temConvite()).toBe(true);
  });

  it('avisa quem está ouvindo quando o convite chega, até cancelar a assinatura', () => {
    const ouvinte = vi.fn();
    const cancelar = convite.assinarConvite(ouvinte);

    convite.guardarConvite(criarEvento());
    expect(ouvinte).toHaveBeenCalledTimes(1);

    cancelar();
    convite.guardarConvite(criarEvento());
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('instalar abre o prompt uma vez e libera o convite, que só vale uma vez', async () => {
    const evento = criarEvento('accepted');
    const ouvinte = vi.fn();
    convite.guardarConvite(evento);
    convite.assinarConvite(ouvinte);

    await expect(convite.instalar()).resolves.toBe(true);
    expect(evento.prompt).toHaveBeenCalledTimes(1);
    expect(convite.temConvite()).toBe(false);
    expect(ouvinte).toHaveBeenCalled();

    await expect(convite.instalar()).resolves.toBe(false);
    expect(evento.prompt).toHaveBeenCalledTimes(1);
  });

  it('recusado no prompt: devolve false e o convite usado não volta', async () => {
    convite.guardarConvite(criarEvento('dismissed'));

    await expect(convite.instalar()).resolves.toBe(false);
    expect(convite.temConvite()).toBe(false);
  });

  it('sem convite, instalar não faz nada', async () => {
    await expect(convite.instalar()).resolves.toBe(false);
  });

  it('app instalado por outro caminho: descarta o convite e avisa', () => {
    const ouvinte = vi.fn();
    convite.guardarConvite(criarEvento());
    convite.assinarConvite(ouvinte);

    convite.descartarConvite();

    expect(convite.temConvite()).toBe(false);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
});

describe('banner de instalação fechado', () => {
  function criarArmazenamento() {
    const dados = new Map();
    return {
      getItem: (chave) => (dados.has(chave) ? dados.get(chave) : null),
      setItem: (chave, valor) => dados.set(chave, String(valor)),
    };
  }

  it('começa aberto e, depois de fechado, continua fechado naquele navegador', () => {
    vi.stubGlobal('localStorage', criarArmazenamento());
    expect(convite.bannerFoiFechado()).toBe(false);

    convite.lembrarBannerFechado();

    expect(convite.bannerFoiFechado()).toBe(true);
  });

  it('com o armazenamento bloqueado, não quebra: o banner só volta a aparecer', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    });

    expect(() => convite.lembrarBannerFechado()).not.toThrow();
    expect(convite.bannerFoiFechado()).toBe(false);
  });
});
