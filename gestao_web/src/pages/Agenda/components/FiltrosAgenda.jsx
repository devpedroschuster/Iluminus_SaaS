import React from 'react';
import { Dumbbell, Music } from 'lucide-react';

export default function FiltrosAgenda({ filtroEspaco, setFiltroEspaco, filtroProf, setFiltroProf, professores, isAdmin }) {
  return (
    <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-2 rounded-[24px] border border-gray-100 shadow-sm shrink-0">
      <div className="flex bg-gray-100 p-1 rounded-2xl w-full md:w-auto">
        <button onClick={() => setFiltroEspaco('todos')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${filtroEspaco === 'todos' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Todos</button>
        <button onClick={() => setFiltroEspaco('funcional')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'funcional' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-orange-500'}`}><Dumbbell size={16} /> Funcional</button>
        <button onClick={() => setFiltroEspaco('danca')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'danca' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-400 hover:text-purple-500'}`}><Music size={16} /> Dança</button>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2 pr-4 w-full md:w-auto">
          <span className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap px-2">Professor:</span>
          <select className="bg-gray-50 px-4 py-2 rounded-xl font-bold text-sm outline-none cursor-pointer w-full" value={filtroProf} onChange={e => setFiltroProf(e.target.value)}>
            <option value="todos">Todos</option>
            {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}