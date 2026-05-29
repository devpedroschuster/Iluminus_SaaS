import { useState, useEffect, useRef } from 'react';

export function usePWA() {
  const [canInstall, setCanInstall] = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    // 1. Intercepta e bloqueia a instalação automática do navegador
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setCanInstall(true); // Avisa a interface que o botão pode aparecer
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setCanInstall(false);
      deferredPrompt.current = null;
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    // 2. Registro simples e silencioso do Service Worker (sem forçar reloads)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Falha ao registrar SW:', err);
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // 3. Função que será chamada APENAS quando o usuário clicar no seu botão
  const install = async () => {
    if (!deferredPrompt.current) return false;
    
    try {
      deferredPrompt.current.prompt();
      const { outcome } = await deferredPrompt.current.userChoice;
      
      if (outcome === 'accepted') {
        setCanInstall(false);
      }
      deferredPrompt.current = null;
      return outcome === 'accepted';
    } catch (err) {
      console.error('[PWA] Erro ao instalar:', err);
      return false;
    }
  };

  // Retorna apenas o necessário para o botão funcionar
  return { canInstall, install };
}