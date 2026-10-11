import { useSyncExternalStore } from 'react';
import { assinarConvite, temConvite, instalar } from '../lib/conviteInstalacao';

// O main.jsx guarda o convite de instalação assim que ele chega e registra o
// service worker para todos os perfis. Aqui só lemos o convite, que pode ter
// chegado antes de esta tela montar (ILU-81).
export function usePWA() {
  const canInstall = useSyncExternalStore(assinarConvite, temConvite);
  return { canInstall, install: instalar };
}
