import React from 'react';
import { X, AlertTriangle, Trash2, CheckCircle, Info } from 'lucide-react';

/**
 * Modal base reutilizável
 */
export default function Modal({ 
  isOpen, 
  onClose, 
  titulo, 
  children, 
  footer = null,
  tamanho = 'md',
  fecharAoClicarFora = true
}) {
  if (!isOpen) return null;

  const tamanhos = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl'
  };

  const handleBackdropClick = (e) => {
    if (fecharAoClicarFora && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/40 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div className={`bg-white dark:bg-[#1A1A1A] border border-transparent dark:border-zinc-800 rounded-[32px] shadow-2xl ${tamanhos[tamanho]} w-full animate-in zoom-in-95 duration-200`}>
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-xl font-black text-gray-800 dark:text-white tracking-tight">{titulo}</h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-400 dark:text-zinc-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 text-gray-700 dark:text-zinc-300">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-6 border-t border-gray-100 dark:border-zinc-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Modal de Confirmação
 */
export function ModalConfirmacao({ 
  isOpen, 
  onClose, 
  onConfirm, 
  titulo = 'Confirmar ação',
  mensagem,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  tipo = 'danger',
  loading = false
}) {
  const icones = {
    danger: <Trash2 size={28} className="text-red-500 dark:text-red-400" />,
    warning: <AlertTriangle size={28} className="text-yellow-500 dark:text-yellow-400" />,
    success: <CheckCircle size={28} className="text-green-500 dark:text-green-400" />,
    info: <Info size={28} className="text-blue-500 dark:text-blue-400" />
  };

  const coresIcone = {
    danger: 'bg-red-50 dark:bg-red-950/30',
    warning: 'bg-yellow-50 dark:bg-yellow-900/30',
    success: 'bg-green-50 dark:bg-green-900/30',
    info: 'bg-blue-50 dark:bg-blue-900/30'
  };

  const coresBotao = {
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    warning: 'bg-yellow-500 hover:bg-yellow-600 text-white dark:text-black', 
    success: 'bg-green-500 hover:bg-green-600 text-white',
    info: 'bg-blue-500 hover:bg-blue-600 text-white'
  };

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titulo="" tamanho="sm">
      <div className="text-center space-y-4">
        {/* Ícone */}
        <div className={`w-20 h-20 ${coresIcone[tipo]} rounded-full flex items-center justify-center mx-auto mb-6`}>
          {icones[tipo]}
        </div>

        {/* Texto */}
        <div className="space-y-3">
          <h3 className="text-2xl font-black text-gray-800 dark:text-white leading-tight">{titulo}</h3>
          <p className="text-sm font-medium text-gray-500 dark:text-zinc-400 leading-relaxed">{mensagem}</p>
        </div>

        {/* Botões */}
        <div className="flex gap-3 pt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 border-2 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 py-4 rounded-2xl font-bold hover:bg-gray-50 dark:hover:bg-zinc-800 transition-all disabled:opacity-50"
          >
            {textoCancelar}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 ${coresBotao[tipo]} py-4 rounded-2xl font-black transition-all disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95 shadow-lg`}
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Processando...
              </>
            ) : (
              textoConfirmar
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function useModal() {
  const [isOpen, setIsOpen] = React.useState(false);

  const abrir = () => setIsOpen(true);
  const fechar = () => setIsOpen(false);
  const toggle = () => setIsOpen(!isOpen);

  return { isOpen, abrir, fechar, toggle };
}