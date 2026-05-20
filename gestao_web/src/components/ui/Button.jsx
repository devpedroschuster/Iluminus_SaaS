import React from 'react';
import { cn } from '../../lib/cn';

const VARIANTS = {
  brand:
    'bg-primary text-primary-foreground hover:opacity-95 shadow-brand active:scale-[0.99]',
  primary:
    'bg-foreground text-background hover:opacity-90 active:scale-[0.99]',
  secondary:
    'bg-muted text-foreground hover:bg-subtle',
  outline:
    'border border-border bg-transparent text-foreground hover:bg-muted',
  ghost:
    'bg-transparent text-foreground hover:bg-muted',
  destructive:
    'bg-destructive text-destructive-foreground hover:opacity-95',
  success:
    'bg-success text-success-foreground hover:opacity-95',
  info:
    'bg-info text-info-foreground hover:opacity-95',
};

const SIZES = {
  sm: 'h-9 px-3 text-xs gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-14 px-6 text-base gap-2',
  icon: 'h-10 w-10 p-0',
};

const Button = React.forwardRef(function Button(
  {
    as: Tag = 'button',
    variant = 'brand',
    size = 'md',
    fullWidth = false,
    loading = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    ...rest
  },
  ref
) {
  return (
    <Tag
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-2xl font-bold uppercase tracking-wide',
        'transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </Tag>
  );
});

export default Button;
