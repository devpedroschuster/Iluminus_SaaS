import React from 'react';
import { Dumbbell, Music, Filter } from 'lucide-react';

export default function FiltrosAgenda({ filtroEspaco, setFiltroEspaco, filtroProf, setFiltroProf, professores, isAdmin }) {
  const inputClass = "w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-iluminus-terracota/20 outline-none transition-all text-gray-700 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-500";
  const iconClass = "absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 pointer-events-none";

  return (
    <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-[#1A1A1A] p-3 rounded-[24px] border border-gray-100 dark:border-zinc-800 shadow-sm shrink-0 transition-colors">
      <div className="flex bg-gray-100 dark:bg-zinc-900 p-1 rounded-2xl w-full md:w-auto">
        <button onClick={() => setFiltroEspaco('todos')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${filtroEspaco === 'todos' ? 'bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300'}`}>Todos</button>
        <button onClick={() => setFiltroEspaco('funcional')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'funcional' ? 'bg-white dark:bg-zinc-800 text-orange-600 dark:text-orange-500 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-orange-500 dark:hover:text-orange-400'}`}><Dumbbell size={16} /> Funcional</button>
        <button onClick={() => setFiltroEspaco('danca')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'danca' ? 'bg-white dark:bg-zinc-800 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-gray-400 dark:text-zinc-500 hover:text-purple-500 dark:hover:text-purple-400'}`}><Music size={16} /> Dança</button>
      </div>
      
      {isAdmin && (
        <div className="flex items-center gap-3 pr-2 w-full md:w-auto">
          <span className="text-xs font-bold text-gray-400 dark:text-zinc-500 uppercase whitespace-nowrap">Professor:</span>
          <div className="relative w-full md:w-56">
            <Filter className={iconClass} size={16} />
            <select 
              className={inputClass}
              value={filtroProf} 
              onChange={(e) => setFiltroProf(e.target.value)}
            >
              <option value="todos">Todos</option>
              {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}