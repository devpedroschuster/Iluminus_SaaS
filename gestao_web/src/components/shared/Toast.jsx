// src/components/shared/Toast.jsx

import React from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';

/**
 * Configuração do Toast Provider
 * Coloque este componente no App.jsx
 */
export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#fff',
          color: '#2D2D2D',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
          border: '1px solid #F0E5DE',
          maxWidth: '400px'
        },
        success: {
          iconTheme: {
            primary: '#10B981',
            secondary: '#fff',
          },
        },
        error: {
          iconTheme: {
            primary: '#EF4444',
            secondary: '#fff',
          },
        },
      }}
    />
  );
}

/**
 * Helper functions para diferentes tipos de toast
 */
export const showToast = {
  success: (mensagem, opcoes = {}) => {
    toast.success(mensagem, {
      icon: <CheckCircle size={20} className="text-green-500" />,
      ...opcoes
    });
  },
  
  error: (mensagem, opcoes = {}) => {
    toast.error(mensagem, {
      icon: <XCircle size={20} className="text-red-500" />,
      ...opcoes
    });
  },
  
  warning: (mensagem, opcoes = {}) => {
    toast(mensagem, {
      icon: <AlertCircle size={20} className="text-yellow-500" />,
      ...opcoes
    });
  },
  
  info: (mensagem, opcoes = {}) => {
    toast(mensagem, {
      icon: <Info size={20} className="text-blue-500" />,
      ...opcoes
    });
  },
  
  // Toast personalizado para ações
  custom: (mensagem, onAction, textoAcao = 'Desfazer') => {
    toast((t) => (
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">{mensagem}</span>
        <button
          onClick={() => {
            onAction();
            toast.dismiss(t.id);
          }}
          className="text-iluminus-terracota font-bold text-sm hover:underline"
        >
          {textoAcao}
        </button>
      </div>
    ), {
      duration: 5000,
    });
  },
  
  // Toast de loading com promise
  promise: (promise, mensagens = {}) => {
    return toast.promise(promise, {
      loading: mensagens.loading || 'Processando...',
      success: mensagens.success || 'Concluído com sucesso!',
      error: mensagens.error || 'Erro ao processar.',
    });
  }
};

/**
 * Exemplos de uso:
 * 
 * import { showToast } from './components/shared/Toast';
 * 
 * showToast.success('Aluno cadastrado com sucesso!');
 * showToast.error('Falha ao salvar dados.');
 * showToast.warning('Atenção: Esta ação é irreversível.');
 * showToast.info('Nova atualização disponível.');
 * 
 * // Com ação de desfazer
 * showToast.custom('Aula excluída', () => restaurarAula(id), 'Desfazer');
 * 
 * // Com promise
 * showToast.promise(
 *   salvarDados(),
 *   {
 *     loading: 'Salvando...',
 *     success: 'Dados salvos!',
 *     error: 'Erro ao salvar.'
 *   }
 * );
 */

export default ToastProvider;
