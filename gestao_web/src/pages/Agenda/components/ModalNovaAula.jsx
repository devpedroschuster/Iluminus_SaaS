import React from 'react';
import { Dumbbell, Music, Palette, RefreshCw } from 'lucide-react';
import { DIAS_SEMANA, PALETA_CORES } from '../../../lib/constants';

export default function ModalNovaAula({ 
  novaAula, setNovaAula, modalidades, professores, savingAula, salvarAula 
}) {
  return (
    <form onSubmit={salvarAula} className="space-y-4 pt-2">
      <div className="flex bg-gray-100 p-1 rounded-2xl mb-2">
        <button 
          type="button" 
          onClick={() => setNovaAula({...novaAula, eh_recorrente: true, data_especifica: ''})} 
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${novaAula.eh_recorrente ? 'bg-white shadow-sm text-iluminus-terracota' : 'text-gray-400'}`}
        >
          Aula Recorrente
        </button>
        <button 
          type="button" 
          onClick={() => setNovaAula({...novaAula, eh_recorrente: false})} 
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${!novaAula.eh_recorrente ? 'bg-white shadow-sm text-iluminus-terracota' : 'text-gray-400'}`}
        >
          Evento Único
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'funcional' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-gray-100 text-gray-400'}`}>
          <input type="radio" name="espaco" className="hidden" checked={novaAula.espaco === 'funcional'} onChange={() => setNovaAula({...novaAula, espaco: 'funcional'})} />
          <Dumbbell size={18} /> <span className="font-bold text-xs uppercase">Funcional</span>
        </label>
        <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'danca' ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-100 text-gray-400'}`}>
          <input type="radio" name="espaco" className="hidden" checked={novaAula.espaco === 'danca'} onChange={() => setNovaAula({...novaAula, espaco: 'danca'})} />
          <Music size={18} /> <span className="font-bold text-xs uppercase">Dança</span>
        </label>
      </div>

      {novaAula.eh_recorrente ? (
        <select 
          className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 font-bold text-gray-700" 
          required 
          value={novaAula.modalidade_id || ''} 
          onChange={e => {
            const val = e.target.value;
            if (!val) return;
            const mod = modalidades.find(m => m.id === val);
            setNovaAula({ ...novaAula, modalidade_id: mod.id, atividade: mod.nome, professor_id: mod.professor_id || '' });
          }}
        >
          <option value="">Modalidade Base...</option>
          {modalidades.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      ) : (
        <input 
          placeholder="Nome do Evento" 
          className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700" 
          required 
          value={novaAula.atividade} 
          onChange={e => setNovaAula({...novaAula, atividade: e.target.value, modalidade_id: ''})} 
        />
      )}

      {novaAula.espaco === 'danca' && (
        <input 
          type="number" 
          placeholder="Valor por aluno (R$)" 
          className="w-full p-4 bg-gray-50 rounded-2xl outline-none border-purple-100 border" 
          value={novaAula.valor_por_aluno} 
          onChange={e => setNovaAula({...novaAula, valor_por_aluno: e.target.value})} 
        />
      )}

      <div>
        <label className="text-[10px] font-black text-gray-400 uppercase flex items-center gap-2 mb-2">
          <Palette size={12}/> Cor no Calendário
        </label>
        <div className="flex gap-2">
          {PALETA_CORES.map(c => (
            <button 
              type="button" 
              key={c.id} 
              onClick={() => setNovaAula({...novaAula, cor: c.id})} 
              className={`w-8 h-8 rounded-full border-2 transition-all ${novaAula.cor === c.id ? 'scale-110 shadow-md' : 'border-transparent'}`} 
              style={{ backgroundColor: c.bg, borderColor: novaAula.cor === c.id ? c.border : 'transparent' }} 
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {novaAula.eh_recorrente ? (
          <select className="w-full p-4 bg-gray-50 rounded-2xl outline-none" value={novaAula.dia_semana} onChange={e => setNovaAula({...novaAula, dia_semana: e.target.value})}>
            {DIAS_SEMANA.map(d => <option key={d.valor} value={d.label}>{d.label}</option>)}
          </select>
        ) : (
          <input type="date" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required value={novaAula.data_especifica} onChange={e => setNovaAula({...novaAula, data_especifica: e.target.value})} />
        )}
        <input type="time" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required value={novaAula.horario} onChange={e => setNovaAula({...novaAula, horario: e.target.value})} />
      </div>
      
      <select className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required value={novaAula.professor_id} onChange={e => setNovaAula({...novaAula, professor_id: e.target.value})}>
        <option value="">Selecione o Professor</option>
        {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
      
      <button disabled={savingAula} className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2">
        {savingAula ? <RefreshCw className="animate-spin" size={20}/> : (novaAula.id ? "Salvar Alterações" : "Salvar na Grade")}
      </button>
    </form>
  );
}