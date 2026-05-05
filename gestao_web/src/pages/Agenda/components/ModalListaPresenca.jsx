import React from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { ModalConfirmacao } from '../../../components/shared/Modal';

export default function ModalListaPresenca({ 
  aulaParaLista, dataLista, setDataLista, listaPresenca, loadingLista, 
  handleRegistrarFalta, handleDesfazerFalta,
  alunoParaRemover, solicitarRemocao, confirmarRemocao, cancelarRemocao, refreshKey
}) {
  if (!aulaParaLista) return null;

  return (
    <div className="space-y-4 pt-2 min-h-[300px]">
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
        <h4 className="font-black text-gray-800">{aulaParaLista.atividade}</h4>
        <div className="mt-2">
          <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Data da Aula</label>
          <input type="date" className="w-full p-2 bg-white rounded-lg outline-none border border-gray-200 font-bold text-gray-700" value={dataLista} onChange={e => setDataLista(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-3">
          <h5 className="font-bold text-sm text-gray-700">Membros da Turma</h5>
        </div>
        {loadingLista ? (
          <div className="flex justify-center p-6"><RefreshCw className="animate-spin text-gray-300" size={24} /></div>
        ) : listaPresenca.length === 0 ? (
          <div className="text-center p-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <p className="text-sm text-gray-400 font-medium">Ninguém matriculado ou agendado ainda.</p>
          </div>
        ) : (
          <ul className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {listaPresenca.map(aluno => (
              <li key={`${aluno.tipo}-${aluno.aluno_id || aluno.nome}`} className={`p-3 border rounded-xl flex justify-between items-center transition-all ${aluno.status === 'ausencia' ? 'bg-red-50/40 border-red-100 opacity-60' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div>
                  <span className={`font-bold text-sm ${aluno.status === 'ausencia' ? 'text-red-800 line-through' : 'text-gray-700'}`}>
                     {aluno.nome}
                  </span>
                  <div className="flex gap-2 mt-1">
                     {aluno.tipo === 'fixo' && <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-black uppercase tracking-wider">Fixo</span>}
                     {aluno.tipo === 'avulso' && <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black uppercase tracking-wider">Avulso</span>}
                     {aluno.tipo === 'experimental' && <span className="text-[9px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-black uppercase tracking-wider">Experimental</span>}
                     {aluno.status === 'ausencia' && <span className="text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-black uppercase tracking-wider">Falta Informada</span>}
                  </div>
                </div>
                
                <div>
                  {aluno.tipo === 'fixo' ? (
                      aluno.status === 'ausencia' ? (
                         <button onClick={() => handleDesfazerFalta(aluno)} className="text-[11px] font-bold text-gray-500 hover:text-green-600 bg-white px-3 py-1.5 rounded-lg shadow-sm border border-gray-200 transition-colors">Desfazer Falta</button>
                      ) : (
                         <button onClick={() => handleRegistrarFalta(aluno)} className="text-[11px] font-bold text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-3 py-1.5 rounded-lg transition-colors">Informar Falta</button>
                      )
                  ) : (
                      <button 
  onClick={() => solicitarRemocao(aluno.id_relacao)} 
  className="text-[11px] font-bold text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
>
  <Trash2 size={14} /> Remover
</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ModalConfirmacao 
        isOpen={!!alunoParaRemover} 
        onClose={cancelarRemocao} 
        onConfirm={confirmarRemocao} 
        titulo="Remover Aluno" 
        mensagem="Tem certeza que deseja remover este aluno desta lista de presença?" 
        tipo="danger" 
      />
    </div>
  );}