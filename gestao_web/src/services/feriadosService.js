import { supabase } from '../lib/supabase';

export const feriadosService = {
  async importarFeriadosNacionais(ano) {
    try {
      const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
      if (!response.ok) throw new Error('Falha ao buscar na Brasil API');
      
      const feriadosApi = await response.json();

      const feriadosFormatados = feriadosApi.map(f => ({
        data: f.date,
        nome: f.name,
        tipo: 'nacional'
      }));

      const { data, error } = await supabase
        .from('feriados')
        .upsert(feriadosFormatados, { onConflict: 'data', ignoreDuplicates: true })
        .select();

      if (error) throw error;
      return data;
      
    } catch (error) {
      console.error('Erro ao importar feriados:', error);
      throw error;
    }
  },

  async listarFeriadosDoAno(ano) {
    const { data, error } = await supabase
      .from('feriados')
      .select('*')
      .gte('data', `${ano}-01-01`)
      .lte('data', `${ano}-12-31`)
      .order('data', { ascending: true });

    if (error) throw error;
    return data;
  }
};