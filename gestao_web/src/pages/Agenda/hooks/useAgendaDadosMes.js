import { useState, useEffect } from 'react';
import { agendamentoService } from '../../../services/agendamentoService';
import { supabase } from '../../../lib/supabase';

export function useAgendaDadosMes(currentDate, atualizarPresencas) {
  const [presencasCalendario, setPresencasCalendario] = useState([]);
  const [excecoesCalendario, setExcecoesCalendario] = useState([]);

  useEffect(() => {
    async function carregarDadosDoMes() {
      try {
        const inicio = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().split('T')[0];
        const fim = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];
        
        const [dadosAvulsos, dadosExcecoes] = await Promise.all([
           agendamentoService.listarPresencasPeriodo(inicio, fim),
           supabase.from('agenda_excecoes').select('*').gte('data_especifica', inicio).lte('data_especifica', fim)
        ]);
        
        setPresencasCalendario(dadosAvulsos || []);
        setExcecoesCalendario(dadosExcecoes.data || []);
      } catch (error) {
        console.error("Erro ao carregar presenças e exceções do mês:", error);
      }
    }
    
    carregarDadosDoMes();
  }, [currentDate.getMonth(), currentDate.getFullYear(), atualizarPresencas]);

  return { presencasCalendario, excecoesCalendario };
}