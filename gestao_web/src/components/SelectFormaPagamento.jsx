import React from 'react';
import { FORMAS_PAGAMENTO } from '../lib/constants';
import { CreditCard } from 'lucide-react';

export default function SelectFormaPagamento({ value, onChange, required = true, name = 'forma_pagamento' }) {
  // Novo padrão unificado
  const inputClass = "w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-iluminus-terracota/20 outline-none transition-all text-gray-700 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-500";

  return (
    <div className="relative w-full">
      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 pointer-events-none" size={18} />
      <select
        name={name}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={inputClass}
      >
        <option value="">Selecione...</option>
        {FORMAS_PAGAMENTO.map((f) => (
          <option key={f.valor} value={f.valor}>{f.label}</option>
        ))}
      </select>
    </div>
  );
}