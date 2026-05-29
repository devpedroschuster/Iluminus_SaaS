import { useState, useEffect, useRef } from 'react';

export function usePWA() {
  const [canInstall, setCanInstall] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const deferredPrompt = useRef(window.__pwaInstallPrompt ?? null);
  const swRegistration = useRef(null);
  const shouldReload = useRef(false);

  useEffect(() => {
    if (window.__pwaInstallPrompt) {
      setCanInstall(true);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      deferredPrompt.current = e;
      setCanInstall(true);
      console.log('[PWA] beforeinstallprompt capturado ✅');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      console.log('[PWA] App instalado ✅');
      setCanInstall(false);
      deferredPrompt.current = null;
      window.__pwaInstallPrompt = null;
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    if ('serviceWorker' in navigator) {
      const handleControllerChange = () => {
        if (shouldReload.current) {
          window.location.reload();
        }
      };
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          swRegistration.current = registration;
          console.log('[SW] Registrado ✅', registration.scope);

          if (registration.waiting) {
            console.log('[SW] Update já disponível na montagem');
            setUpdateAvailable(true);
          }

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            console.log('[SW] Novo SW encontrado, aguardando instalação...');

            newWorker.addEventListener('statechange', () => {
              console.log('[SW] Estado do novo SW:', newWorker.state);
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] Update disponível ✅');
                setUpdateAvailable(true);
              }
            });
          });
        })
        .catch((err) => {
          console.error('[SW] Erro ao registrar ❌', err);
        });
    } else {
      console.warn('[PWA] Service Worker não suportado neste browser');
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    const prompt = deferredPrompt.current ?? window.__pwaInstallPrompt;
    if (!prompt) {
      console.warn('[PWA] Nenhum prompt de instalação disponível');
      return false;
    }
    try {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      console.log('[PWA] Resultado da instalação:', outcome);
      deferredPrompt.current = null;
      window.__pwaInstallPrompt = null;
      setCanInstall(false);
      return outcome === 'accepted';
    } catch (err) {
      console.error('[PWA] Erro ao instalar:', err);
      return false;
    }
  };

  const applyUpdate = () => {
    const sw = swRegistration.current?.waiting;
    if (sw) {
      shouldReload.current = true;
      sw.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  const isInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  return { canInstall, install, updateAvailable, applyUpdate, isInstalled };
}