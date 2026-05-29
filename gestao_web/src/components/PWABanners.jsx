import React, { useState } from 'react';
import { X, Share } from 'lucide-react';

function useIsIOS() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  return isIOS && !isStandalone;
}

export function PWABanners() {
  const [installDismissed, setInstallDismissed] = useState(false);
  const isIOS = useIsIOS();

  if (!isIOS || installDismissed) return null;

  return (
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
  );
}