import { useState } from 'react';

export function useAgendaPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState('week');
  const [filtroProf, setFiltroProf] = useState('todos');
  const [filtroEspaco, setFiltroEspaco] = useState('todos');

  return {
    currentDate, setCurrentDate,
    currentView, setCurrentView,
    filtroProf, setFiltroProf,
    filtroEspaco, setFiltroEspaco
  };
}