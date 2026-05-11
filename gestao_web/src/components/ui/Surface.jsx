import React from 'react';
import { cn } from '../../lib/cn';

/**
 * Superfície semântica. Substitui bg-white / bg-gray-50 espalhados.
 *
 * variant:
 *  - card     : superfície principal (bg-card, com sombra suave)
 *  - muted    : superfície secundária (bg-muted, sem sombra)
 *  - elevated : card com sombra mais marcada
 *  - flat     : sem sombra, sem fundo (apenas borda)
 */
const VARIANTS = {
  card: 'bg-card text-card-foreground border border-border shadow-card',
  muted: 'bg-muted text-foreground',
  elevated: 'bg-card text-card-foreground border border-border shadow-brand',
  flat: 'bg-transparent border border-border',
};

const PADDINGS = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  xl: 'p-8',
};

const Surface = React.forwardRef(function Surface(
  { variant = 'card', padding = 'lg', as: Tag = 'div', className, children, ...rest },
  ref
) {
  return (
    <Tag
      ref={ref}
      className={cn('rounded-3xl', VARIANTS[variant], PADDINGS[padding], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export default Surface;
