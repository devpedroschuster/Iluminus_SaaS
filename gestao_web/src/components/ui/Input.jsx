import React from 'react';
import { cn } from '../../lib/cn';

/**
 * Wrapper único para inputs/selects/textareas.
 * Resolve cor de fundo, borda, foco, placeholder em light + dark de uma vez.
 *
 * Uso:
 *   <Input value={...} onChange={...} placeholder="Email" />
 *   <Input as="select"><option/></Input>
 *   <Input as="textarea" rows={4} />
 *   <Input leftIcon={<Mail size={16}/>} />
 */
export const inputBaseClass = cn(
  'w-full rounded-xl border border-border bg-input text-foreground',
  'placeholder:text-muted-foreground',
  'px-4 py-3 text-sm font-medium',
  'outline-none transition-all',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring',
  'disabled:opacity-50 disabled:pointer-events-none'
);

const Input = React.forwardRef(function Input(
  { as = 'input', leftIcon, rightIcon, className, wrapperClassName, ...rest },
  ref
) {
  const Tag = as;
  const padded = cn(
    inputBaseClass,
    leftIcon && 'pl-10',
    rightIcon && 'pr-10',
    className
  );

  if (!leftIcon && !rightIcon) {
    return <Tag ref={ref} className={padded} {...rest} />;
  }

  return (
    <div className={cn('relative', wrapperClassName)}>
      {leftIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {leftIcon}
        </span>
      )}
      <Tag ref={ref} className={padded} {...rest} />
      {rightIcon && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {rightIcon}
        </span>
      )}
    </div>
  );
});

export default Input;

/** Atalho útil para labels de formulário */
export function Label({ children, htmlFor, className, required }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground',
        className
      )}
    >
      {children}
      {required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}
