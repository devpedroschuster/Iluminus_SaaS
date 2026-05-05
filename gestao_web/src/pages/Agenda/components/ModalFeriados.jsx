import React from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { ModalConfirmacao } from '../../../components/shared/Modal';

export default function ModalFeriados({ 
  feriados, novoFeriado, setNovoFeriado, savingFeriado, salvarFeriado, 
  feriadoParaExcluir, solicitarExclusao, confirmarExclusao, cancelarExclusao 
}) {
  return (
    <div className="space-y-6 pt-2">
      <form onSubmit={salvarFeriado} className="flex gap-2">
        <input type="date" required className="p-3 bg-gray-50 rounded-xl outline-none text-sm font-medium" value={novoFeriado.data} onChange={e => setNovoFeriado({...novoFeriado, data: e.target.value})} />
        <input type="text" required placeholder="Motivo (ex: Feriado Nacional)" className="flex-1 p-3 bg-gray-50 rounded-xl outline-none text-sm" value={novoFeriado.descricao} onChange={e => setNovoFeriado({...novoFeriado, descricao: e.target.value})} />
        <button disabled={savingFeriado} className="bg-gray-800 text-white px-4 rounded-xl font-bold hover:bg-gray-700 transition-colors">
          {savingFeriado ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
        </button>
      </form>

      <div>
        <h4 className="font-bold text-sm text-gray-700 mb-3">Bloqueios Futuros</h4>
        {feriados.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum bloqueio cadastrado.</p>
        ) : (
          <ul className="space-y-2">
            {feriados.map(f => (
              <li key={f.id} className="flex justify-between items-center p-3 bg-red-50 text-red-700 rounded-xl border border-red-100">
                <div>
                  <span className="font-black text-sm block">{new Date(f.data + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                  <span className="text-xs">{f.descricao}</span>
                </div>
                <button type="button" onClick={() => solicitarExclusao(f.id)} className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors">
                   <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ModalConfirmacao 
        isOpen={!!feriadoParaExcluir} 
        onClose={cancelarExclusao} 
        onConfirm={confirmarExclusao} 
        titulo="Remover Bloqueio" 
        mensagem="Tem certeza que deseja remover este bloqueio da agenda?" 
        tipo="danger" 
      />
    </div>
  );
}