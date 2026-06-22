import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// Chave pública VAPID — gerada uma única vez com `npx web-push generate-vapid-keys`
// e configurada como variável de ambiente no build do frontend.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

const SUPORTADO =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function usePushNotifications() {
  const { professorId } = useAuth();
  const [permissao, setPermissao] = useState(SUPORTADO ? Notification.permission : 'unsupported');
  const [inscrito, setInscrito] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // Verifica, ao carregar, se já existe uma subscription ativa neste dispositivo
  useEffect(() => {
    if (!SUPORTADO || !professorId) return;

    let cancelado = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelado) setInscrito(!!subscription);
      } catch {
        // Falha silenciosa — apenas mantém inscrito=false
      }
    })();

    return () => { cancelado = true; };
  }, [professorId]);

  const ativarNotificacoes = useCallback(async () => {
    if (!SUPORTADO) {
      setErro('Seu navegador não suporta notificações push.');
      return false;
    }
    if (!professorId) {
      setErro('Não foi possível identificar o professor logado.');
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      setErro('Configuração de notificações ausente. Contate o suporte.');
      return false;
    }

    setCarregando(true);
    setErro(null);
    try {
      const permissaoConcedida = await Notification.requestPermission();
      setPermissao(permissaoConcedida);
      if (permissaoConcedida !== 'granted') {
        return false;
      }

      const registration = await navigator.serviceWorker.ready;

      // Reaproveita subscription existente se já houver uma (evita duplicar)
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const subJson = subscription.toJSON();
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          professor_id: professorId,
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          user_agent: navigator.userAgent,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

      if (error) throw error;

      setInscrito(true);
      return true;
    } catch (err) {
      setErro('Não foi possível ativar as notificações. Tente novamente.');
      return false;
    } finally {
      setCarregando(false);
    }
  }, [professorId]);

  const desativarNotificacoes = useCallback(async () => {
    if (!SUPORTADO) return;
    setCarregando(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
      setInscrito(false);
    } catch {
      setErro('Não foi possível desativar as notificações.');
    } finally {
      setCarregando(false);
    }
  }, []);

  return {
    suportado: SUPORTADO,
    permissao, // 'default' | 'granted' | 'denied' | 'unsupported'
    inscrito,
    carregando,
    erro,
    ativarNotificacoes,
    desativarNotificacoes,
  };
}