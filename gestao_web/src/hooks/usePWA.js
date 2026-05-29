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
      setCanInstall((prev) => (prev ? prev : true));
};
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
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

      navigator.serviceWorker.ready.then((registration) => {
        swRegistration.current = registration;

        if (registration.waiting) {
          setUpdateAvailable(true);
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      });

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.removeEventListener('appinstalled', handleAppInstalled);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
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