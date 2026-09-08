import React from 'react';
import { toast } from 'react-hot-toast';
import { CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';

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

  custom: (mensagem, onAction, textoAcao = 'Desfazer') => {
    toast((t) => (
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">{mensagem}</span>
        <button
          onClick={() => {
            onAction();
            toast.dismiss(t.id);
          }}
          className="text-primary font-bold text-sm hover:underline"
        >
          {textoAcao}
        </button>
      </div>
    ), {
      duration: 5000,
    });
  },

  promise: (promise, mensagens = {}) => {
    return toast.promise(promise, {
      loading: mensagens.loading || 'Processando...',
      success: mensagens.success || 'Concluído com sucesso!',
      error: mensagens.error || 'Erro ao processar.',
    });
  }
};
