// src/components/shared/Modal.jsx

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
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div className={`bg-white rounded-3xl shadow-2xl ${tamanhos[tamanho]} w-full animate-in zoom-in-95 duration-200`}>
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800">{titulo}</h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-6 border-t border-gray-100">
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
  tipo = 'danger', // danger, warning, success, info
  loading = false
}) {
  const icones = {
    danger: <Trash2 size={24} className="text-red-500" />,
    warning: <AlertTriangle size={24} className="text-yellow-500" />,
    success: <CheckCircle size={24} className="text-green-500" />,
    info: <Info size={24} className="text-blue-500" />
  };

  const coresIcone = {
    danger: 'bg-red-50',
    warning: 'bg-yellow-50',
    success: 'bg-green-50',
    info: 'bg-blue-50'
  };

  const coresBotao = {
    danger: 'bg-red-500 hover:bg-red-600',
    warning: 'bg-yellow-500 hover:bg-yellow-600',
    success: 'bg-green-500 hover:bg-green-600',
    info: 'bg-blue-500 hover:bg-blue-600'
  };

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titulo="" tamanho="sm">
      <div className="text-center space-y-4">
        {/* Ícone */}
        <div className={`w-16 h-16 ${coresIcone[tipo]} rounded-full flex items-center justify-center mx-auto`}>
          {icones[tipo]}
        </div>

        {/* Texto */}
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
          <p className="text-sm text-gray-500">{mensagem}</p>
        </div>

        {/* Botões */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 border-2 border-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            {textoCancelar}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 ${coresBotao[tipo]} text-white py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2`}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
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

/**
 * Hook para gerenciar estado do modal
 */
export function useModal() {
  const [isOpen, setIsOpen] = React.useState(false);

  const abrir = () => setIsOpen(true);
  const fechar = () => setIsOpen(false);
  const toggle = () => setIsOpen(!isOpen);

  return { isOpen, abrir, fechar, toggle };
}

/**
 * Exemplos de uso:
 * 
 * // Modal básico
 * const { isOpen, abrir, fechar } = useModal();
 * 
 * <Modal isOpen={isOpen} onClose={fechar} titulo="Editar Aluno">
 *   <form>...</form>
 * </Modal>
 * 
 * // Modal de confirmação
 * const { isOpen: confirmarOpen, abrir: confirmarAbrir, fechar: confirmarFechar } = useModal();
 * 
 * <ModalConfirmacao
 *   isOpen={confirmarOpen}
 *   onClose={confirmarFechar}
 *   onConfirm={async () => await excluirAluno(id)}
 *   tipo="danger"
 *   titulo="Excluir aluno"
 *   mensagem="Esta ação não pode ser desfeita. Deseja continuar?"
 *   textoConfirmar="Sim, excluir"
 * />
 */
