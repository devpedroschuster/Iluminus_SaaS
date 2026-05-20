import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../providers/ThemeProvider';
import { cn } from '../../lib/cn';

export default function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme();

  const opts = [
    { value: 'light', icon: Sun, label: 'Claro' },
    { value: 'system', icon: Monitor, label: 'Sistema' },
    { value: 'dark', icon: Moon, label: 'Escuro' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn(
        'inline-flex items-center gap-1 rounded-2xl border border-border bg-muted p-1',
        className
      )}
    >
      {opts.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-xl transition-all',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
