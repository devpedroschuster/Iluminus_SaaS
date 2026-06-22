import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

const STORAGE_KEY_DISPENSADO = 'iluminus_push_banner_dispensado';

export function PushNotificationBanner() {
  const { suportado, permissao, inscrito, carregando, ativarNotificacoes } = usePushNotifications();
  const [dispensado, setDispensado] = useState(false);

  useEffect(() => {
    setDispensado(localStorage.getItem(STORAGE_KEY_DISPENSADO) === '1');
  }, []);

  const dispensar = () => {
    localStorage.setItem(STORAGE_KEY_DISPENSADO, '1');
    setDispensado(true);
  };

  // Não mostra se: navegador não suporta, já está inscrito, já negou
  // permissão anteriormente, ou o professor já dispensou o banner antes.
  if (!suportado || inscrito || permissao === 'denied' || dispensado) return null;

  const handleAtivar = async () => {
    const sucesso = await ativarNotificacoes();
    if (sucesso) setDispensado(true); // não mostra mais depois de ativar
  };

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xl">
        <Bell className="h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Ativar notificações</p>
          <p className="text-xs text-muted-foreground">
            Receba um aviso quando sua aula mudar de horário, for cancelada ou um aluno faltar.
          </p>
          <button
            onClick={handleAtivar}
            disabled={carregando}
            className="mt-2 text-xs font-bold text-primary hover:underline disabled:opacity-60"
          >
            {carregando ? 'Ativando...' : 'Ativar agora'}
          </button>
        </div>
        <button
          onClick={dispensar}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}