import React, { useState } from 'react';
import { Calendar, DownloadCloud, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/shared/Toast';

export default function ConfiguracoesFeriados() {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [feriadosImportados, setFeriadosImportados] = useState([]);

  const importarDaBrasilAPI = async () => {
    setLoading(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
      if (!response.ok) throw new Error('Erro na Brasil API');
      
      const dadosApi = await response.json();

      const feriadosFormatados = dadosApi.map(f => ({
        data: f.date,
        descricao: f.name + ' (Feriado Nacional)',
        bloqueia_agenda: true
      }));

      const { error } = await supabase
        .from('feriados')
        .upsert(feriadosFormatados, { onConflict: 'data', ignoreDuplicates: true });

      if (error) throw error;

      setFeriadosImportados(dadosApi);
      showToast.success(`${dadosApi.length} feriados nacionais de ${ano} importados para a agenda!`);
      
    } catch (error) {
      console.error(error);
      showToast.error("Não foi possível importar os feriados. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8 animate-in fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-gray-800 tracking-tight flex items-center gap-2">
          <Calendar className="text-iluminus-terracota" /> 
          Calendário e Feriados
        </h1>
        <p className="text-gray-500 font-medium">Automatize os bloqueios da agenda importando os feriados nacionais.</p>
      </div>

      <div className="bg-white rounded-[32px] p-8 shadow-sm border border-gray-50 flex flex-col md:flex-row items-center gap-8">
        <div className="flex-1 space-y-4">
          <h2 className="text-lg font-bold text-gray-800">Importação Automática (Brasil API)</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            Puxe automaticamente todos os feriados nacionais de um ano específico. 
            Feriados locais (como 20 de Setembro) devem continuar sendo adicionados manualmente pelo botão "Bloqueios" na Agenda.
          </p>
          
          <div className="flex items-center gap-4 pt-4">
            <select 
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              className="border border-gray-200 bg-gray-50 rounded-2xl p-4 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-500"
            >
              {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <button 
              onClick={importarDaBrasilAPI}
              disabled={loading}
              className="flex items-center gap-2 bg-gray-800 text-white px-8 py-4 rounded-2xl font-black hover:bg-black transition-all disabled:opacity-50 active:scale-95 shadow-lg"
            >
              <DownloadCloud size={20} />
              {loading ? 'Buscando...' : `Importar Feriados de ${ano}`}
            </button>
          </div>
        </div>

        <div className="w-full md:w-1/3 bg-orange-50 rounded-3xl p-6 border border-orange-100">
          <div className="flex items-center gap-2 text-orange-800 font-black mb-2">
            <AlertCircle size={20} /> Como funciona?
          </div>
          <p className="text-sm text-orange-700 font-medium">
            A importação é inteligente e ignora datas duplicadas. Você pode apertar o botão quantas vezes quiser sem medo de criar feriados repetidos na agenda.
          </p>
        </div>
      </div>

      {feriadosImportados.length > 0 && (
        <div className="mt-8 bg-white rounded-[32px] shadow-sm border border-gray-50 overflow-hidden animate-in slide-in-from-bottom-4">
          <div className="p-6 border-b border-gray-50 bg-green-50 flex items-center gap-2 text-green-700 font-bold">
            <CheckCircle size={20} /> Bloqueios inseridos na agenda com sucesso:
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <tbody className="divide-y divide-gray-50">
                {feriadosImportados.map((f, i) => (
                  <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-bold text-gray-700 w-32 pl-6">
                      {new Date(f.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-4 font-medium text-gray-600">{f.name}</td>
                    <td className="p-4 text-right pr-6">
                      <span className="bg-gray-100 text-gray-500 text-[10px] font-black uppercase px-3 py-1 rounded-full border border-gray-200">
                        Bloqueio Nacional
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}