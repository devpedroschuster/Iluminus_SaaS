/**
 * usePWA
 * Gerencia o registro do Service Worker, o prompt de instalação
 * e a detecção de atualizações disponíveis.
 *
 * Uso:
 *   const { canInstall, install, updateAvailable, applyUpdate } = usePWA();
 */
import { useState, useEffect, useRef } from 'react';

export function usePWA() {
  const [canInstall, setCanInstall] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const deferredPrompt = useRef(null);
  const swRegistration = useRef(null);

  useEffect(() => {
    // ── Registrar Service Worker ───────────────────────────
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          swRegistration.current = registration;

          // Verifica update a cada vez que a aba ganha foco
          registration.update();

          // Detecta novo SW esperando para ativar
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                // Há uma nova versão disponível
                setUpdateAvailable(true);
              }
            });
          });
        })
        .catch((err) => {
          console.error('[SW] Erro ao registrar:', err);
        });

      // Detecta quando o SW recém-ativado assume o controle
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Recarrega a página para usar o novo SW (só se o user pediu update)
        // Não recarrega automaticamente para não interromper o trabalho
      });
    }

    // ── Prompt de instalação (Android/Desktop) ────────────
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setCanInstall(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Esconde o botão após instalação
    window.addEventListener('appinstalled', () => {
      setCanInstall(false);
      deferredPrompt.current = null;
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  /**
   * Aciona o prompt nativo de instalação do browser.
   * Retorna true se o usuário aceitou, false se recusou.
   */
  const install = async () => {
    if (!deferredPrompt.current) return false;
    deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    deferredPrompt.current = null;
    setCanInstall(false);
    return outcome === 'accepted';
  };

  /**
   * Manda o SW em espera ativar imediatamente e recarrega a página.
   */
  const applyUpdate = () => {
    const sw = swRegistration.current?.waiting;
    if (sw) {
      sw.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  };

  /** Verdadeiro se o app está rodando em modo standalone (instalado). */
  const isInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  return { canInstall, install, updateAvailable, applyUpdate, isInstalled };
}
