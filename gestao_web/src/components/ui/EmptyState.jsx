import React from 'react';
import { cn } from '../../lib/cn';

/**
 * Estado vazio padronizado pra listas (Alunos, Leads, Despesas, etc.)
 *
 * <EmptyState
 *   icon={<Users size={28} />}
 *   title="Nenhum aluno encontrado"
 *   description="Cadastre seu primeiro aluno para começar."
 *   action={<Button variant="brand">Novo aluno</Button>}
 * />
 */
export default function EmptyState({ icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-16 px-6 rounded-3xl border border-dashed border-border bg-muted/30',
        className
      )}
    >
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          {icon}
        </div>
      )}
      <h3 className="text-base font-black text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
