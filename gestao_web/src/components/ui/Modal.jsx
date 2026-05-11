import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Modal acessível (Esc fecha, click no overlay fecha, foco preso no conteúdo).
 * SUBSTITUI o Modal antigo do projeto e já vem 100% temático.
 *
 * Uso:
 *   const m = useModal();
 *   <Button onClick={m.abrir}>Abrir</Button>
 *   <Modal {...m} title="Editar aluno" size="md">
 *     ...
 *     <Modal.Footer>
 *       <Button variant="ghost" onClick={m.fechar}>Cancelar</Button>
 *       <Button variant="brand" onClick={salvar}>Salvar</Button>
 *     </Modal.Footer>
 *   </Modal>
 */

export function useModal(initial = false) {
  const [aberto, setAberto] = useState(initial);
  return {
    aberto,
    abrir: useCallback(() => setAberto(true), []),
    fechar: useCallback(() => setAberto(false), []),
  };
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw]',
};

function Modal({
  aberto,
  fechar,
  title,
  description,
  size = 'md',
  children,
  closeOnOverlay = true,
  className,
  hideClose = false,
}) {
  // Esc + lock de scroll
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e) => e.key === 'Escape' && fechar();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [aberto, fechar]);

  if (!aberto || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* overlay */}
      <div
        onClick={closeOnOverlay ? fechar : undefined}
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-in fade-in duration-150"
      />

      {/* conteúdo */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative z-10 w-full rounded-3xl bg-card text-card-foreground border border-border shadow-card',
          'max-h-[90vh] overflow-hidden flex flex-col',
          'animate-in fade-in zoom-in-95 duration-200',
          SIZES[size],
          className
        )}
      >
        {(title || !hideClose) && (
          <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
            <div className="min-w-0">
              {title && (
                <h2 className="text-lg font-black tracking-tight text-foreground truncate">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            {!hideClose && (
              <button
                onClick={fechar}
                aria-label="Fechar"
                className="-mr-2 -mt-2 inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </header>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
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
