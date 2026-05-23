/**
 * usePWA — Espaço Iluminus
 *
 * CORREÇÃO PRINCIPAL:
 * O evento `beforeinstallprompt` dispara muito cedo no carregamento da página,
 * antes do React terminar de montar os componentes. Se o addEventListener for
 * registrado dentro do useEffect, o evento já passou e nunca é capturado.
 *
 * Solução: capturar o evento em uma variável global ANTES do React iniciar,
 * direto no main.jsx (ou num script inline no index.html), e ler essa variável
 * dentro do hook.
 */

import { useState, useEffect, useRef } from 'react';

export function usePWA() {
  // Lê o prompt que foi capturado globalmente antes do React montar
  const [canInstall, setCanInstall] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const deferredPrompt = useRef(window.__pwaInstallPrompt ?? null);
  const swRegistration = useRef(null);

  useEffect(() => {
    // ── Se o prompt já foi capturado antes do React montar ────
    if (window.__pwaInstallPrompt) {
      setCanInstall(true);
    }

    // ── Listener para capturar prompts futuros (hot-reload, etc.) ──
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      deferredPrompt.current = e;
      setCanInstall(true);
      console.log('[PWA] beforeinstallprompt capturado ✅');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // ── Esconde o botão se o app já foi instalado ─────────────
    const handleAppInstalled = () => {
      console.log('[PWA] App instalado ✅');
      setCanInstall(false);
      deferredPrompt.current = null;
      window.__pwaInstallPrompt = null;
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    // ── Registrar Service Worker ───────────────────────────────
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          swRegistration.current = registration;
          console.log('[SW] Registrado ✅', registration.scope);

          // Verifica se há um SW em espera logo ao registrar
          if (registration.waiting) {
            console.log('[SW] Update já disponível na montagem');
            setUpdateAvailable(true);
          }

          // Detecta novo SW durante a sessão
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
      sw.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  };

  const isInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  return { canInstall, install, updateAvailable, applyUpdate, isInstalled };
}