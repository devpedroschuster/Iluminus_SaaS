import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, CheckCircle, XCircle, Clock, RefreshCw, MessageCircle, LayoutGrid, List, X, ChevronDown } from 'lucide-react';
import { showToast } from '../components/shared/Toast';

import { useLeadsPendentes, useHistoricoLeads, useAtualizarStatusLead } from '../hooks/useLeads';

export default function Leads() {
  const navigate = useNavigate();
  const [visaoAtiva, setVisaoAtiva] = useState('cards');
  const [confirmandoId, setConfirmandoId] = useState(null); 

  const { data: leadsPendentes = [], isLoading: loadingPendentes } = useLeadsPendentes();
  
  const { 
    data: historicoData, 
    isLoading: loadingHistorico,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage
  } = useHistoricoLeads();

  const mutationStatus = useAtualizarStatusLead();

  const leadsHistorico = historicoData?.pages.flatMap(page => page) || [];

  function marcarComoPerdido(leadId) {
    setConfirmandoId(null);
    
    mutationStatus.mutate({ id: leadId, status: 'perdido' }, {
      onSuccess: () => showToast.success("Visitante marcado como perdido.")
    });
  }

  function formatarData(dataIso) {
    if (!dataIso) return '';
    return new Date(dataIso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatarDataHora(dataIso) {
    if (!dataIso) return '';
    return new Date(dataIso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function contatarWhatsApp(lead) {
    if (!lead.telefone_visitante) {
      showToast.error("Este visitante não deixou o número de WhatsApp.");
      return;
    }
    const numeroLimpo = lead.telefone_visitante.replace(/\D/g, '');
    const mensagem = encodeURIComponent(`Olá ${lead.nome_visitante}, tudo bem? Aqui é do Espaço Iluminus! O que achou da sua aula experimental de ${lead.agenda?.atividade}?`);
    window.open(`https://wa.me/55${numeroLimpo}?text=${mensagem}`, '_blank');
  }

  function iniciarMatricula(lead) {
    navigate('/alunos/novo', { state: { leadParaConversao: lead } });
  }

const isProcessando = (id) => mutationStatus.isPending && mutationStatus.variables?.id === id;
const loading = visaoAtiva === 'cards' ? loadingPendentes : loadingHistorico;

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
      
      {/* CABEÇALHO E ALTERNADOR DE VISÃO */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 flex items-center gap-3">
            <Clock className="text-orange-500" size={32} /> 
            CRM de Experimentais
          </h1>
          <p className="text-gray-500 mt-2">Converta visitantes em alunos e acompanhe o histórico.</p>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl shadow-inner">
          <button 
            onClick={() => setVisaoAtiva('cards')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black uppercase transition-all ${visaoAtiva === 'cards' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <LayoutGrid size={18} /> Ação ({leadsPendentes.length})
          </button>
          <button 
            onClick={() => setVisaoAtiva('lista')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black uppercase transition-all ${visaoAtiva === 'lista' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <List size={18} /> Histórico Completo
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="animate-spin text-orange-400" size={40} />
        </div>
      ) : visaoAtiva === 'cards' ? (
        
        leadsPendentes.length === 0 ? (
          <div className="bg-white p-12 rounded-[40px] border border-gray-100 shadow-sm text-center">
            <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">Caixa de Entrada Zerada!</h3>
            <p className="text-gray-500">Todos os leads já foram contatados ou convertidos.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {leadsPendentes.map(lead => (
              <div key={lead.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col relative group">
                {confirmandoId === lead.id ? (
                  <div className="absolute top-3 right-3 flex items-center gap-1 bg-white p-1 rounded-xl shadow-sm border border-red-100 animate-in fade-in zoom-in-95 z-10">
                    <button 
                      onClick={() => marcarComoPerdido(lead.id)}
                      className="text-[10px] font-black uppercase tracking-wider px-3 py-2 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white rounded-lg transition-colors flex items-center gap-1"
                    >
                      Excluir?
                    </button>
                    <button 
                      onClick={() => setConfirmandoId(null)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Cancelar"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setConfirmandoId(lead.id)}
                    disabled={isProcessando(lead.id)}
                    className="absolute top-4 right-4 p-2 text-gray-300 hover:text-red-500 bg-gray-50 hover:bg-red-50 rounded-xl transition-all"
                    title="Descartar visitante"
                  >
                    {isProcessando(lead.id) ? <RefreshCw size={18} className="animate-spin text-red-500"/> : <XCircle size={18} />}
                  </button>
                )}

                <div className="mb-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-orange-600 bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-lg inline-block mb-3">
                    {lead.agenda?.atividade}
                  </span>
                  <h3 className="font-black text-gray-800 text-xl leading-tight">{lead.nome_visitante}</h3>
                  <p className="text-xs font-bold text-gray-400 mt-1">Realizou em: {formatarData(lead.data_checkin)}</p>
                </div>

                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 mb-6 flex items-center gap-3">
                   <MessageCircle size={18} className={lead.telefone_visitante ? "text-green-500" : "text-gray-400"} />
                   <span className={`text-sm font-bold ${lead.telefone_visitante ? "text-gray-700" : "text-gray-400 italic"}`}>
                     {lead.telefone_visitante || "Sem telefone cadastrado"}
                   </span>
                </div>

                <div className="flex gap-2 mt-auto">
                  <button 
                    onClick={() => contatarWhatsApp(lead)}
                    disabled={!lead.telefone_visitante}
                    className="flex-1 bg-green-500 text-white p-3.5 rounded-2xl font-bold flex justify-center items-center gap-2 hover:bg-green-600 transition-all disabled:opacity-50 disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm shadow-green-100"
                  >
                    <Phone size={18} /> Contatar
                  </button>
                  <button 
                    onClick={() => iniciarMatricula(lead)}
                    className="flex-1 bg-blue-600 text-white p-3.5 rounded-2xl font-bold flex justify-center items-center gap-2 hover:bg-blue-700 transition-all shadow-sm shadow-blue-100"
                  >
                    <CheckCircle size={18} /> Matricular
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
                  <th className="p-4 font-black">Data da Aula</th>
                  <th className="p-4 font-black">Visitante</th>
                  <th className="p-4 font-black">Contato</th>
                  <th className="p-4 font-black">Modalidade</th>
                  <th className="p-4 font-black">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leadsHistorico.map(lead => (
                  <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 text-sm font-bold text-gray-500">{formatarDataHora(lead.data_checkin)}</td>
                    <td className="p-4 text-sm font-black text-gray-800">{lead.nome_visitante}</td>
                    <td className="p-4 text-sm font-medium text-gray-600">{lead.telefone_visitante || '-'}</td>
                    <td className="p-4">
                      <span className="text-[11px] font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded-md">
                        {lead.agenda?.atividade}
                      </span>
                    </td>
                    <td className="p-4">
                      {lead.status_conversao === 'convertido' && <span className="bg-green-100 text-green-700 px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1 w-max"><CheckCircle size={12}/> Convertido</span>}
                      {lead.status_conversao === 'pendente' && <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1 w-max"><Clock size={12}/> Pendente</span>}
                      {lead.status_conversao === 'perdido' && <span className="bg-red-100 text-red-700 px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1 w-max"><XCircle size={12}/> Perdido</span>}
                    </td>
                  </tr>
                ))}
                {leadsHistorico.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-gray-400 font-medium">Nenhum histórico registrado.</td>
                  </tr>
                )}
              </tbody>
              
              {visaoAtiva === 'lista' && hasNextPage && (
                <tfoot>
                  <tr>
                    <td colSpan="5" className="p-4 bg-gray-50/50 text-center border-t border-gray-100">
                      <button 
                        onClick={() => fetchNextPage()} 
                        disabled={isFetchingNextPage}
                        className="inline-flex items-center gap-2 px-6 py-2.5 bg-white border border-gray-200 text-sm font-bold text-gray-600 rounded-xl hover:bg-gray-50 hover:text-iluminus-terracota transition-all shadow-sm disabled:opacity-50"
                      >
                        {isFetchingNextPage ? (
                          <><RefreshCw size={16} className="animate-spin" /> Carregando mais...</>
                        ) : (
                          <><ChevronDown size={16} /> Carregar registros anteriores</>
                        )}
                      </button>
                    </td>
                  </tr>
                </tfoot>
              )}

            </table>
          </div>
        </div>
      )}
    </div>
  );
}