// Convite de instalação do app (evento beforeinstallprompt do Chrome).
// O evento chega uma vez por carregamento, às vezes antes de a tela com o botão
// "Instalar" montar. Por isso o main.jsx o entrega aqui assim que chega e o
// usePWA lê daqui, em vez de cada tela escutar o evento por conta própria.

let convite = null;
const ouvintes = new Set();

const avisar = () => ouvintes.forEach((ouvinte) => ouvinte());

export function guardarConvite(evento) {
  evento.preventDefault();
  convite = evento;
  avisar();
}

export function assinarConvite(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export const temConvite = () => convite !== null;

export function descartarConvite() {
  convite = null;
  avisar();
}

export async function instalar() {
  if (!convite) return false;
  // O prompt só pode ser aberto uma vez por convite, aceito ou não.
  const atual = convite;
  descartarConvite();
  try {
    await atual.prompt();
    const { outcome } = await atual.userChoice;
    return outcome === 'accepted';
  } catch (err) {
    console.error('[PWA] Erro ao instalar:', err);
    return false;
  }
}

// "Fechar" no banner de instalação vale para aquele navegador. Sem
// armazenamento (aba anônima, dados bloqueados), o banner só volta a aparecer.
const CHAVE_BANNER_FECHADO = 'iluminus:banner-instalacao-fechado';

export function bannerFoiFechado() {
  try {
    return localStorage.getItem(CHAVE_BANNER_FECHADO) === '1';
  } catch {
    return false;
  }
}

export function lembrarBannerFechado() {
  try {
    localStorage.setItem(CHAVE_BANNER_FECHADO, '1');
  } catch {
    // sem armazenamento: nada a fazer
  }
}
