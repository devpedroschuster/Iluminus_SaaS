import { useState, useCallback } from 'react';

export function useModal(initial = false) {
  const [aberto, setAberto] = useState(initial);
  const abrir  = useCallback(() => setAberto(true),          []);
  const fechar = useCallback(() => setAberto(false),         []);
  const toggle = useCallback(() => setAberto((v) => !v),     []);
  return { aberto, isOpen: aberto, abrir, fechar, toggle };
}
