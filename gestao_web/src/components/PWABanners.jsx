import React, { useState } from 'react';
import { X, Share, Download } from 'lucide-react';
import { cn } from '../lib/cn';
import { usePWA } from '../hooks/usePWA';
import { bannerFoiFechado, lembrarBannerFechado } from '../lib/conviteInstalacao';

function useIsIOS() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  return isIOS && !isStandalone;
}

// oferecerInstalacao: além do aviso do iPhone, mostra o botão "Instalar" onde o
// Chrome oferece a instalação. Hoje só a Área do Aluno usa (ILU-81); o admin tem
// o botão na sidebar. tema="claro" mantém o banner claro com o modo escuro ligado.
export function PWABanners({ oferecerInstalacao = false, tema }) {
  const [fechado, setFechado] = useState(bannerFoiFechado);
  const isIOS = useIsIOS();
  const { canInstall, install } = usePWA();

  const mostrarInstalar = oferecerInstalacao && canInstall && !isIOS;
  if (fechado || (!isIOS && !mostrarInstalar)) return null;

  const fechar = () => {
    lembrarBannerFechado();
    setFechado(true);
  };

  return (
    <div
      className={cn(
        'pwa-banner fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm',
        tema === 'claro' && 'tema-claro'
      )}
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xl">
        {isIOS ? (
          <>
            <Share className="h-5 w-5 shrink-0 text-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Instalar no iPhone</p>
              <p className="text-xs text-muted-foreground">
                Toque em <strong>Compartilhar</strong> <span aria-hidden>⬆️</span> e depois{' '}
                <strong>"Adicionar à Tela de Início"</strong>.
              </p>
            </div>
          </>
        ) : (
          <>
            <Download className="h-5 w-5 shrink-0 text-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Instale o app do Iluminus</p>
              <p className="text-xs text-muted-foreground">Abra direto da tela inicial, como um aplicativo.</p>
            </div>
            <button
              onClick={install}
              className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-xs font-bold text-card hover:opacity-90 transition-opacity"
            >
              Instalar
            </button>
          </>
        )}
        <button
          onClick={fechar}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
