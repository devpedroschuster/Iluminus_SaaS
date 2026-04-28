import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Ban, UserCheck, RefreshCw, Edit2, Trash2, Users, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// 🔥 IMPORTAÇÕES DIRETAS (Para evitar conflitos)
import { gradeService } from '../../services/gradeService';
import { agendamentoService } from '../../services/agendamentoService';
import { useAgenda } from '../../hooks/useAgenda';
import { useAlunos } from '../../hooks/useAlunos';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/shared/Toast';
import Modal, { useModal, ModalConfirmacao } from '../../components/shared/Modal';
import { TableSkeleton } from '../../components/shared/Loading';

import { useEventosCalendario } from './hooks/useEventosCalendario';
import { useAgendamento } from './hooks/useAgendamento';
import { useListaPresenca } from './hooks/useListaPresenca';
import FiltrosAgenda from './components/FiltrosAgenda';
import CalendarioGrade from './components/CalendarioGrade';
import ModalAgendamento from './components/ModalAgendamento';
import ModalNovaAula from './components/ModalNovaAula';
import ModalListaPresenca from './components/ModalListaPresenca';
import ModalFeriados from './components/ModalFeriados';
import { useFeriados } from './hooks/useFeriados';
import { PALETA_CORES } from '../../lib/constants';

export default function Agenda() {
  const { perfil } = useOutletContext();
  const isAdmin = perfil === 'admin';

  const initialFormState = { 
    id: null, atividade: '', modalidade_id: '', professor_id: '', dia_semana: 'Segunda-feira', 
    horario: '', capacidade: 15, eh_recorrente: true, data_especifica: '', espaco: 'funcional',
    valor_por_aluno: '', cor: 'laranja'
  };

  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState('week');
  const [atualizarPresencas, setAtualizarPresencas] = useState(0);
  
  const [filtroProf, setFiltroProf] = useState('todos');
  const [filtroEspaco, setFiltroEspaco] = useState('todos'); 

  const [professores, setProfessores] = useState([]);
  const [modalidades, setModalidades] = useState([]);
  const [matriculasFixas, setMatriculasFixas] = useState([]); 
  const [presencasCalendario, setPresencasCalendario] = useState([]); 
  const [excecoesCalendario, setExcecoesCalendario] = useState([]); 

  const [novaAula, setNovaAula] = useState(initialFormState);
  const [eventoSelecionado, setEventoSelecionado] = useState(null);
  const [aulaParaLista, setAulaParaLista] = useState(null);
  const [dataLista, setDataLista] = useState(new Date().toISOString().split('T')[0]);
  const [savingAula, setSavingAula] = useState(false);

  const { aulas, feriados, loading, refetch } = useAgenda();
  const { alunos: listaAlunos } = useAlunos({ role: 'aluno' }); 

  const modalNovaAula = useModal();
  const modalAgendamentoModal = useModal();
  const modalLista = useModal();
  const modalAcoesEvento = useModal();
  const modalFeriados = useModal();
  const modalExcluirAula = useModal();
  const modalEncerrarAula = useModal();

  // HOOKS
  const eventosCalendario = useEventosCalendario({ aulas, feriados, presencasCalendario, matriculasFixas, excecoesCalendario, filtroProf, filtroEspaco, currentDate, currentView });
  const hookAgendamento = useAgendamento(() => { modalAgendamentoModal.fechar(); setAtualizarPresencas(prev => prev + 1); }, feriados);
  const hookLista = useListaPresenca(aulaParaLista, dataLista, modalLista.isOpen, () => setAtualizarPresencas(prev => prev + 1));
  const hookFeriados = useFeriados(refetch);
  
  useEffect(() => {
    async function carregarDadosIniciais() {
      // 🔥 BLINDA O CÓDIGO CONTRA FALHAS SILENCIOSAS
      try {
        const [profData, modData, fixasData] = await Promise.all([
          gradeService.listarProfessores(),
          gradeService.listarModalidades(),
          gradeService.listarMatriculasFixas() 
        ]);
        setProfessores(profData || []);
        setModalidades(modData || []);
        setMatriculasFixas(fixasData || []);
      } catch (error) {
        console.error("Erro ao carregar dados iniciais da agenda:", error);
      }
    }
    carregarDadosIniciais();
  }, []);

  useEffect(() => {
    async function carregarDadosDoMes() {
      try {
        const inicio = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().split('T')[0];
        const fim = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];
        const [dadosAvulsos, dadosExcecoes] = await Promise.all([
           agendamentoService.listarPresencasPeriodo(inicio, fim),
           supabase.from('agenda_excecoes').select('*').gte('data_especifica', inicio).lte('data_especifica', fim)
        ]);
        setPresencasCalendario(dadosAvulsos || []);
        setExcecoesCalendario(dadosExcecoes.data || []);
      } catch (error) {
        console.error("Erro ao carregar presenças e exceções do mês:", error);
      }
    }
    carregarDadosDoMes();
  }, [currentDate.getMonth(), currentDate.getFullYear(), atualizarPresencas]);

  const salvarAula = async (e) => {
    e.preventDefault();
    setSavingAula(true);
    
    try {
      const payload = {
        atividade: novaAula.atividade,
        modalidade_id: novaAula.modalidade_id || null,
        professor_id: novaAula.professor_id,
        horario: novaAula.horario,
        capacidade: Number(novaAula.capacidade) || 15,
        eh_recorrente: novaAula.eh_recorrente,
        espaco: novaAula.espaco,
        ativa: true,
        valor_por_aluno: Number(novaAula.valor_por_aluno) || 0,
        cor: novaAula.cor || 'laranja'
      };

      if (novaAula.id) payload.id = novaAula.id;

      if (novaAula.eh_recorrente) {
        payload.dia_semana = novaAula.dia_semana; 
        payload.data_especifica = null;
        if (!payload.modalidade_id) throw new Error("Selecione uma Modalidade para aulas recorrentes.");
      } else {
        if (!novaAula.data_especifica) throw new Error("Data é obrigatória para evento único.");
        payload.data_especifica = novaAula.data_especifica;
        const diaCalculado = format(new Date(novaAula.data_especifica + 'T12:00:00'), 'eeee', { locale: ptBR });
        payload.dia_semana = diaCalculado.charAt(0).toUpperCase() + diaCalculado.slice(1);
      }

      await gradeService.salvarAula(payload);
      showToast.success("Grade atualizada com sucesso!");
      modalNovaAula.fechar();
      refetch();
    } catch (err) { 
      showToast.error(err.message); 
    } finally { 
      setSavingAula(false); 
    }
  };

  const excluirAula = async () => {
    if (!eventoSelecionado) return;
    try {
      await gradeService.excluirAula(eventoSelecionado.dadosOriginais.id);
      showToast.success("Grade removida com sucesso.");
      modalExcluirAula.fechar();
      modalAcoesEvento.fechar();
      refetch();
    } catch (err) { 
      showToast.error("Erro ao excluir."); 
    }
  };

  const encerrarAula = async () => {
    if (!eventoSelecionado) return;
    try {
      const dataClicada = format(eventoSelecionado.start, 'yyyy-MM-dd');
      await gradeService.encerrarAula(eventoSelecionado.dadosOriginais.id, dataClicada);
      showToast.success("Turma encerrada desta data em diante. O histórico foi mantido!");
      modalEncerrarAula.fechar();
      modalAcoesEvento.fechar();
      refetch();
    } catch (err) { 
      showToast.error("Erro ao encerrar a turma."); 
    }
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500 min-h-screen flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Grade de Aulas</h1>
          <p className="text-gray-500 font-medium">Visualize e organize a agenda do estúdio.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {isAdmin && (
            <button onClick={modalFeriados.abrir} className="bg-gray-100 text-gray-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-200 transition-colors">
              <Ban size={20} /> Bloqueios ({feriados.length})
            </button>
          )}
          
          <button onClick={() => { hookAgendamento.setAgendamentoForm({...hookAgendamento.agendamentoForm, aula_id: '', data_aula: ''}); modalAgendamentoModal.abrir(); }} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold flex gap-2">
            <UserCheck size={20} /> {isAdmin ? "Agendar na Turma" : "Agendar Aluno"}
          </button>
          
          {isAdmin && (
            <button onClick={() => { setNovaAula(initialFormState); modalNovaAula.abrir(); }} className="bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-bold flex gap-2">
              <Plus size={20} /> Nova Aula
            </button>
          )}
        </div>
      </div>

      <FiltrosAgenda 
        filtroEspaco={filtroEspaco} setFiltroEspaco={setFiltroEspaco}
        filtroProf={filtroProf} setFiltroProf={setFiltroProf}
        professores={professores} isAdmin={isAdmin}
      />

      <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm" style={{ height: '750px' }}>
        {loading ? <TableSkeleton /> : (
          <CalendarioGrade 
             eventos={eventosCalendario} currentDate={currentDate} setCurrentDate={setCurrentDate}
             currentView={currentView} setCurrentView={setCurrentView}
             handleSelectSlot={({start}) => {
                if(!isAdmin) return;
                
                const dataStr = format(start, 'yyyy-MM-dd');
                const ehFeriado = feriados.find(f => f.data === dataStr && f.bloqueia_agenda);
                if (ehFeriado) {
                    showToast.error(`Data bloqueada: ${ehFeriado.descricao}`);
                    return;
                }

                const dia = format(start, 'eeee', { locale: ptBR });
                setNovaAula({...initialFormState, horario: format(start, 'HH:mm'), dia_semana: dia.charAt(0).toUpperCase() + dia.slice(1), data_especifica: dataStr});
                modalNovaAula.abrir();
             }}
            handleSelectEvent={(ev) => { 
                if (ev.isFeriado) {
                   showToast.error(`Este dia está bloqueado: ${ev.dadosOriginais.descricao}`);
                   return;
                }
                setEventoSelecionado(ev); 
                modalAcoesEvento.abrir(); 
             }}
          />
        )}
      </div>

      {/* MODAIS (mantidos iguais) */}
      <Modal isOpen={modalAgendamentoModal.isOpen} onClose={modalAgendamentoModal.fechar} titulo="Agendamento">
        <ModalAgendamento {...hookAgendamento} aulas={aulas} listaAlunos={listaAlunos} />
      </Modal>

      <Modal isOpen={modalNovaAula.isOpen} onClose={modalNovaAula.fechar} titulo={novaAula.id ? "Editar Atividade" : "Nova Aula"}>
        <ModalNovaAula 
          novaAula={novaAula} setNovaAula={setNovaAula} 
          modalidades={modalidades} professores={professores} 
          savingAula={savingAula} salvarAula={salvarAula} 
        />
      </Modal>

      <Modal isOpen={modalLista.isOpen} onClose={modalLista.fechar} titulo="Chamada">
        <ModalListaPresenca {...hookLista} aulaParaLista={aulaParaLista} dataLista={dataLista} setDataLista={setDataLista} />
      </Modal>

      <Modal isOpen={modalAcoesEvento.isOpen} onClose={modalAcoesEvento.fechar} titulo="Detalhes da Aula">
        {eventoSelecionado && (() => {
          const corTema = PALETA_CORES.find(c => c.id === (eventoSelecionado.dadosOriginais.cor || 'laranja')) || PALETA_CORES[0];
          
          return (
            <div className="space-y-4 pt-2">
              <div className="p-5 rounded-2xl border" style={{ backgroundColor: corTema.bg, borderColor: corTema.border }}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-black text-xl" style={{ color: corTema.text }}>{eventoSelecionado.title}</h3>
                  <span className="bg-white px-3 py-1 rounded-lg text-xs font-bold shadow-sm" style={{ color: corTema.text }}>
                    {format(eventoSelecionado.start, 'HH:mm')}
                  </span>
                </div>
                <p className="text-sm font-medium" style={{ color: corTema.text, opacity: 0.8 }}>
                  Prof: {eventoSelecionado.dadosOriginais.professores?.nome || 'Não definido'}
                </p>
                <p className="text-xs mt-2" style={{ color: corTema.text, opacity: 0.7 }}>
                  {format(eventoSelecionado.start, "EEEE, d 'de' MMMM", { locale: ptBR })}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 mt-4">
                <button 
                  onClick={() => { 
                    modalAcoesEvento.fechar(); 
                    hookAgendamento.setAgendamentoForm({tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: eventoSelecionado.dadosOriginais.id, data_aula: format(eventoSelecionado.start, 'yyyy-MM-dd')}); 
                    modalAgendamentoModal.abrir(); 
                  }} 
                  className="w-full bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-colors shadow-sm mb-2"
                >
                  <UserPlus size={20} /> Agendar Aluno Neste Horário
                </button>

                <button 
                  onClick={() => { 
                    modalAcoesEvento.fechar(); 
                    setAulaParaLista(eventoSelecionado.dadosOriginais); 
                    setDataLista(format(eventoSelecionado.start, 'yyyy-MM-dd')); 
                    modalLista.abrir(); 
                  }} 
                  className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <Users size={20} /> Fazer Chamada / Lista de Alunos
                </button>
                
                {isAdmin && (
                  <div className="flex flex-col gap-2 mt-2">
                    <button 
                      onClick={() => { 
                        modalAcoesEvento.fechar(); 
                        setNovaAula({...eventoSelecionado.dadosOriginais}); 
                        modalNovaAula.abrir(); 
                      }} 
                      className="w-full bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      <Edit2 size={18} /> Editar Cadastro da Grade
                    </button>
                    
                    <div className="flex gap-2">
                      {eventoSelecionado.dadosOriginais.eh_recorrente && !eventoSelecionado.dadosOriginais.data_fim && (
                        <button 
                          onClick={() => modalEncerrarAula.abrir()} 
                          className="flex-1 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-500 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors"
                        >
                          <Ban size={18} /> Encerrar Turma
                        </button>
                      )}

                      <button 
                        onClick={() => modalExcluirAula.abrir()} 
                        className="flex-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      >
                        <Trash2 size={18} /> Excluir (Apagar Tudo)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

      {isAdmin && (
        <Modal isOpen={modalFeriados.isOpen} onClose={modalFeriados.fechar} titulo="Gerenciar Bloqueios (Feriados)">
          <ModalFeriados feriados={feriados} {...hookFeriados} />
        </Modal>
      )}

      <ModalConfirmacao 
        isOpen={modalEncerrarAula.isOpen}
        onClose={modalEncerrarAula.fechar}
        onConfirm={encerrarAula}
        titulo="Encerrar Turma e Manter Histórico"
        mensagem={`A partir do dia ${eventoSelecionado ? format(eventoSelecionado.start, 'dd/MM/yyyy') : ''}, esta turma de "${eventoSelecionado?.dadosOriginais?.atividade}" não aparecerá mais na agenda.\n\nTodo o histórico de presenças e pagamentos anteriores será preservado. Confirma o encerramento?`}
        tipo="warning"
      />
    </div>
  );
}