import React from 'react';
import { cn } from '../../lib/cn';

const SOFT = {
  brand: 'bg-primary-soft text-primary',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  purple: 'bg-purple-soft text-purple',
  neutral: 'bg-muted text-muted-foreground',
};

const SOLID = {
  brand: 'bg-primary text-primary-foreground',
  info: 'bg-info text-info-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  purple: 'bg-purple text-white',
  neutral: 'bg-foreground text-background',
};

const OUTLINE = {
  brand: 'border border-primary text-primary',
  info: 'border border-info text-info',
  success: 'border border-success text-success',
  warning: 'border border-warning text-warning',
  destructive: 'border border-destructive text-destructive',
  purple: 'border border-purple text-purple',
  neutral: 'border border-border text-muted-foreground',
};

export default function Badge({
  tone = 'neutral',
  variant = 'soft',
  className,
  children,
  ...rest
}) {
  const map = variant === 'solid' ? SOLID : variant === 'outline' ? OUTLINE : SOFT;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide',
        map[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
