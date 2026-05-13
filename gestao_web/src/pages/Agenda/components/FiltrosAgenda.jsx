import React from 'react';
import { Dumbbell, Music, Filter } from 'lucide-react';
import Surface from '../../../components/ui/Surface';
import Input from '../../../components/ui/Input';

export default function FiltrosAgenda({ 
  filtroEspaco, 
  setFiltroEspaco, 
  filtroProf, 
  setFiltroProf, 
  professores, 
  isAdmin 
}) {
  return (
    <Surface 
      variant="card" 
      padding="sm" 
      className="flex flex-col md:flex-row gap-4 justify-between items-center shrink-0 mb-4"
    >
      {/* Botões de Filtro de Espaço */}
      <div className="flex bg-muted p-1 rounded-2xl w-full md:w-auto border border-border">
        <button 
          onClick={() => setFiltroEspaco('todos')} 
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
            filtroEspaco === 'todos' 
              ? 'bg-card text-foreground shadow-sm' 
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Todos
        </button>
        <button 
          onClick={() => setFiltroEspaco('funcional')} 
          className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
            filtroEspaco === 'funcional' 
              ? 'bg-warning-soft text-warning shadow-sm border border-warning/20' 
              : 'text-muted-foreground hover:text-warning'
          }`}
        >
          <Dumbbell size={16} /> Funcional
        </button>
        <button 
          onClick={() => setFiltroEspaco('danca')} 
          className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
            filtroEspaco === 'danca' 
              ? 'bg-purple-soft text-purple shadow-sm border border-purple/20' 
              : 'text-muted-foreground hover:text-purple'
          }`}
        >
          <Music size={16} /> Dança
        </button>
      </div>

      {/* Select de Professor (Somente Admin) */}
      {isAdmin && (
        <div className="flex items-center gap-3 pr-2 w-full md:w-auto">
          <span className="text-xs font-bold text-muted-foreground uppercase whitespace-nowrap">
            Professor:
          </span>
          <div className="w-full md:w-56">
            <Input 
              as="select"
              leftIcon={<Filter size={16} />}
              value={filtroProf} 
              onChange={(e) => setFiltroProf(e.target.value)}
            >
              <option value="todos">Todos</option>
              {professores.map(p => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Input>
          </div>
        </div>
      )}
    </Surface>
  );
}