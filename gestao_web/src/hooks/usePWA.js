import { useState, useEffect, useRef } from 'react';

export function usePWA() {
  const [canInstall, setCanInstall] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
  const deferredPrompt = useRef(window.__pwaInstallPrompt ?? null);
  const swRegistration = useRef(null);

  useEffect(() => {
    if (isInstalled) return;

    if (window.__pwaInstallPrompt) {
      deferredPrompt.current = window.__pwaInstallPrompt;
      setCanInstall(true);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      deferredPrompt.current = e;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setCanInstall(false);
      deferredPrompt.current = null;
      window.__pwaInstallPrompt = null;
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    if ('serviceWorker' in navigator) {
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
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isInstalled]);

  const install = async () => {
    const prompt = deferredPrompt.current ?? window.__pwaInstallPrompt;
    if (!prompt) return false;
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
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
      sw.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  return { canInstall, install, updateAvailable, applyUpdate, isInstalled };
}