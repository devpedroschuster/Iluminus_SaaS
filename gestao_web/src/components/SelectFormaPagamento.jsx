import React from 'react';
import { FORMAS_PAGAMENTO } from '../lib/constants';
import { CreditCard } from 'lucide-react';
import Input from './ui/Input';

export default function SelectFormaPagamento({ 
  value, 
  onChange, 
  required = true, 
  name = 'forma_pagamento' 
}) {
  return (
    <Input
      as="select"
      name={name}
      required={required}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      leftIcon={<CreditCard size={18} />}
    >
      <option value="">Selecione...</option>
      {FORMAS_PAGAMENTO.map((f) => (
        <option key={f.valor} value={f.valor}>
          {f.label}
        </option>
      ))}
    </Input>
  );
}