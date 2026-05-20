import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Trash2, CheckCircle, Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import Button from './Button';

export function useModal(initial = false) {
  const [aberto, setAberto] = useState(initial);
  const abrir  = useCallback(() => setAberto(true),          []);
  const fechar = useCallback(() => setAberto(false),         []);
  const toggle = useCallback(() => setAberto((v) => !v),     []);
  return { aberto, isOpen: aberto, abrir, fechar, toggle };
}

const SIZES = {
  sm:   'max-w-md',
  md:   'max-w-xl',
  lg:   'max-w-2xl',
  xl:   'max-w-4xl',
  full: 'max-w-[95vw]',
};

const SIZES_LEGACY = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-xl',
  '2xl':'max-w-2xl',
};

function Modal({
  aberto,
  fechar,
  title,
  description,
  size = 'md',
  closeOnOverlay = true,
  hideClose = false,
  className,
  children,

  isOpen,
  onClose,
  titulo,
  tamanho,
  fecharAoClicarFora,
  footer,
}) {
  const _aberto        = aberto          ?? isOpen              ?? false;
  const _fechar        = fechar          ?? onClose             ?? (() => {});
  const _title         = title           ?? titulo;
  const _closeOnOverlay= fecharAoClicarFora !== undefined
                           ? fecharAoClicarFora
                           : closeOnOverlay;
  const _sizeClass = tamanho
    ? (SIZES_LEGACY[tamanho] ?? SIZES_LEGACY.md)
    : (SIZES[size]           ?? SIZES.md);

  useEffect(() => {
    if (!_aberto) return;
    const onKey = (e) => e.key === 'Escape' && _fechar();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [_aberto, _fechar]);

  if (!_aberto || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={_title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Overlay */}
      <div
        onClick={_closeOnOverlay ? _fechar : undefined}
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-in fade-in duration-150"
      />

      {/* Painel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative z-10 w-full rounded-3xl bg-card text-card-foreground border border-border shadow-card',
          'max-h-[90vh] overflow-hidden flex flex-col',
          'animate-in fade-in zoom-in-95 duration-200',
          _sizeClass,
          className
        )}
      >
        {/* Cabeçalho */}
        {(_title || !hideClose) && (
          <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border shrink-0">
            <div className="min-w-0">
              {_title && (
                <h2 className="text-lg font-black tracking-tight text-foreground truncate">
                  {_title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            {!hideClose && (
              <button
                onClick={_fechar}
                aria-label="Fechar"
                className="-mr-2 -mt-2 inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </header>
        )}

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

Modal.Footer = function ModalFooter({ className, children }) {
  return (
    <div
      className={cn(
        'mt-6 -mx-6 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-6 py-4',
        className
      )}
    >
      {children}
    </div>
  );
};

export default Modal;

export function ModalConfirmacao({
  // API nova
  aberto,
  fechar,
  // API legada
  isOpen,
  onClose,
  // Props comuns
  onConfirm,
  titulo          = 'Confirmar ação',
  mensagem,
  textoConfirmar  = 'Confirmar',
  textoCancelar   = 'Cancelar',
  tipo            = 'danger',
  loading         = false,
}) {
  const _aberto = aberto ?? isOpen ?? false;
  const _fechar = fechar ?? onClose ?? (() => {});

  const icones = {
    danger:  <Trash2      size={28} className="text-destructive" />,
    warning: <AlertTriangle size={28} className="text-warning"   />,
    success: <CheckCircle size={28} className="text-success"     />,
    info:    <Info        size={28} className="text-info"        />,
  };

  const bgIcone = {
    danger:  'bg-destructive-soft',
    warning: 'bg-warning-soft',
    success: 'bg-success-soft',
    info:    'bg-info-soft',
  };

  const btnVariant = {
    danger:  'destructive',
    success: 'success',
    info:    'info',
    warning: 'ghost',
  };

  const handleConfirm = async () => {
    await onConfirm();
    _fechar();
  };

  return (
    <Modal
      aberto={_aberto}
      fechar={_fechar}
      title=""
      size="sm"
      hideClose
    >
      <div className="text-center space-y-4 py-2">
        {/* Ícone */}
        <div
          className={cn(
            'w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6',
            bgIcone[tipo]
          )}
        >
          {icones[tipo]}
        </div>

        {/* Textos */}
        <div className="space-y-3">
          <h3 className="text-2xl font-black text-foreground leading-tight">
            {titulo}
          </h3>
          <p className="text-sm font-medium text-muted-foreground leading-relaxed">
            {mensagem}
          </p>
        </div>

        {/* Botões */}
        <div className="flex gap-3 pt-6">
          <Button
            variant="outline"
            fullWidth
            size="lg"
            onClick={_fechar}
            disabled={loading}
          >
            {textoCancelar}
          </Button>

          <Button
            variant={btnVariant[tipo]}
            fullWidth
            size="lg"
            loading={loading}
            onClick={handleConfirm}
            className={cn(
              tipo === 'warning' && 'bg-warning text-warning-foreground hover:opacity-90 hover:bg-warning'
            )}
          >
            {textoConfirmar}
          </Button>
        </div>
      </div>
    </Modal>
  );
}