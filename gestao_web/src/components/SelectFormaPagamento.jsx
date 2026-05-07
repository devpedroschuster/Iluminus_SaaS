import { FORMAS_PAGAMENTO } from '../lib/constants';

export default function SelectFormaPagamento({ value, onChange, required = true, name = 'forma_pagamento' }) {
  return (
    <select
      name={name}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="w-full border rounded px-3 py-2"
    >
      <option value="">Selecione...</option>
      {FORMAS_PAGAMENTO.map((f) => (
        <option key={f.valor} value={f.valor}>{f.label}</option>
      ))}
    </select>
  );
}
