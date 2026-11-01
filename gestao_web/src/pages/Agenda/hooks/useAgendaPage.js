import { useState } from 'react';

export function useAgendaPage() {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // UX: mobile usa 'day' para legibilidade; desktop usa 'week' para ambos os perfis
  const defaultView = isMobile ? 'day' : 'week';

  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState(defaultView);
  const [filtroProf, setFiltroProf] = useState('todos');
  const [filtroEspaco, setFiltroEspaco] = useState('todos');

  return {
    currentDate, setCurrentDate,
    currentView, setCurrentView,
    filtroProf, setFiltroProf,
    filtroEspaco, setFiltroEspaco
  };
}