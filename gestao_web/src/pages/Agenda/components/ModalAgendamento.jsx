import React from 'react';
import { UserCheck, RefreshCw } from 'lucide-react';

export default function ModalAgendamento({ agendamentoForm, setAgendamentoForm, aulas, listaAlunos, handleAgendarAluno, savingAgendamento, infoVaga, verificandoVaga }) {
  return (
    <form onSubmit={(e) => handleAgendarAluno(e)} className="space-y-4 pt-2">
      <div className="flex bg-gray-100 p-1 rounded-2xl mb-4">
          <button type="button" onClick={() => setAgendamentoForm({...agendamentoForm, tipo: 'cadastrado'})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'cadastrado' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}>Aluno da Casa</button>
          <button type="button" onClick={() => setAgendamentoForm({...agendamentoForm, tipo: 'visitante'})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'visitante' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`}>Aula Experimental</button>
      </div>

      <select required className="w-full p-4 bg-gray-50 rounded-2xl outline-none" value={agendamentoForm.aula_id} onChange={e => setAgendamentoForm({...agendamentoForm, aula_id: e.target.value})}>
        <option value="">Selecione a aula da grade...</option>
        {aulas.map(aula => <option key={aula.id} value={aula.id}>{aula.atividade} - {aula.eh_recorrente ? aula.dia_semana : 'Evento Único'} às {aula.horario?.slice(0, 5)}</option>)}
      </select>

      {agendamentoForm.tipo === 'cadastrado' ? (
        <select required className="w-full p-4 bg-gray-50 rounded-2xl outline-none" value={agendamentoForm.aluno_id} onChange={e => setAgendamentoForm({...agendamentoForm, aluno_id: e.target.value})}>
          <option value="">Selecione o aluno...</option>
          {listaAlunos.map(a => <option key={a.id} value={a.id}>{a.nome_completo}</option>)}
        </select>
      ) : (
        <input required type="text" placeholder="Nome Visitante" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" value={agendamentoForm.nome_visitante} onChange={e => setAgendamentoForm({...agendamentoForm, nome_visitante: e.target.value})} />
      )}

      <input type="date" required className="w-full p-4 bg-gray-50 rounded-2xl outline-none" value={agendamentoForm.data_aula} onChange={e => setAgendamentoForm({...agendamentoForm, data_aula: e.target.value})} />
      
      <div className="min-h-[60px] animate-in fade-in">
          {verificandoVaga ? (
            <div className="flex items-center justify-center p-3 text-gray-400 text-xs font-bold gap-2"><RefreshCw size={14} className="animate-spin"/> Verificando créditos e vagas...</div>
          ) : infoVaga && (
            <div className="flex flex-col md:flex-row gap-2">
                <div className={`flex-1 p-3 rounded-xl border font-bold text-xs flex items-center justify-between ${infoVaga.ocupacaoAtual >= infoVaga.capacidadeMax ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                  <span>Lotação da Turma</span>
                  <span className="bg-white/50 px-2 py-1 rounded-md">{infoVaga.ocupacaoAtual} de {infoVaga.capacidadeMax}</span>
                </div>
                
                {agendamentoForm.tipo === 'cadastrado' && agendamentoForm.aluno_id && (
                  <div className={`flex-1 p-3 rounded-xl border font-bold text-xs flex flex-col justify-center ${infoVaga.temModalidadeNoPlano === false ? 'bg-red-50 text-red-700 border-red-200' : (infoVaga.usoSemanal >= infoVaga.limiteSemanal && !infoVaga.isLivre ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-blue-50 text-blue-700 border-blue-200')}`}>
                    <div className="flex justify-between items-center">
                        <span>Uso na Semana ({infoVaga.modNome})</span>
                        {infoVaga.temModalidadeNoPlano === false ? (
                           <span className="bg-white/50 px-2 py-1 rounded-md text-[10px] uppercase text-red-700">Bloqueado na Área</span>
                        ) : infoVaga.isLivre ? (
                           <span className="bg-white/50 px-2 py-1 rounded-md text-[10px] uppercase">Livre</span>
                        ) : (
                           <span className="bg-white/50 px-2 py-1 rounded-md">{infoVaga.usoSemanal} de {infoVaga.limiteSemanal}</span>
                        )}
                    </div>
                  </div>
                )}
            </div>
          )}
      </div>

      <button disabled={savingAgendamento} className={`w-full text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 ${agendamentoForm.tipo === 'cadastrado' ? 'bg-blue-600' : 'bg-orange-500'}`}>
        {savingAgendamento ? <RefreshCw className="animate-spin" size={20}/> : <UserCheck size={20}/>} Confirmar Vaga
      </button>
    </form>
  );
}