import React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,

  titulo,
  mensagem,
}) {
  const _title       = title       ?? titulo;
  const _description = description ?? mensagem;

  const _icon = icon ?? ((titulo !== undefined || mensagem !== undefined)
    ? <Search size={28} />
    : undefined);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-16 px-6 rounded-3xl border border-dashed border-border bg-muted/30',
        className
      )}
    >
      {_icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          {_icon}
        </div>
      )}

      {_title && (
        <h3 className="text-base font-black text-foreground">{_title}</h3>
      )}

      {_description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{_description}</p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}