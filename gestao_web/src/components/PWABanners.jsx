import React, { useState } from 'react';
import { Download, RefreshCw, X, Share } from 'lucide-react';
import { usePWA } from '../hooks/usePWA';

function useIsIOS() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  return isIOS && !isStandalone;
}

export function PWABanners() {
  const { canInstall, install, updateAvailable, applyUpdate, isInstalled } = usePWA();
  const [installDismissed, setInstallDismissed] = useState(false);
  const isIOS = useIsIOS();

  return (
    <>
      {updateAvailable && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-card px-4 py-3 shadow-xl">
            <RefreshCw className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Nova versão disponível</p>
              <p className="text-xs text-muted-foreground">Atualize para ter as últimas melhorias.</p>
            </div>
            <button
              onClick={applyUpdate}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Atualizar
            </button>
          </div>
        </div>
      )}

      {canInstall && !installDismissed && !isInstalled && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xl">
            <Download className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Instalar o Iluminus</p>
              <p className="text-xs text-muted-foreground">Acesse direto da tela inicial, sem abrir o navegador.</p>
            </div>
            <button
              onClick={install}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Instalar
            </button>
            <button
              onClick={() => setInstallDismissed(true)}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isIOS && !installDismissed && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xl">
            <Share className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Instalar no iPhone</p>
              <p className="text-xs text-muted-foreground">
                Toque em <strong>Compartilhar</strong> <span aria-hidden>⬆️</span> e depois{' '}
                <strong>"Adicionar à Tela de Início"</strong>.
              </p>
            </div>
            <button
              onClick={() => setInstallDismissed(true)}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}