import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Ban, UserCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { gradeService } from '../../services/gradeService';
import { useAgenda } from '../../hooks/useAgenda';
import { useAlunos } from '../../hooks/useAlunos';
import Modal, { useModal, ModalConfirmacao } from '../../components/shared/Modal';
import { TableSkeleton } from '../../components/shared/Loading';
import { showToast } from '../../components/shared/Toast';

import { useAgendaPage } from './hooks/useAgendaPage';
import { useAgendaDadosMes } from './hooks/useAgendaDadosMes';
import { useGradeMutations } from './hooks/useGradeMutations';
import { useEventosCalendario } from './hooks/useEventosCalendario';
import { useAgendamento } from './hooks/useAgendamento';
import { useListaPresenca } from './hooks/useListaPresenca';
import { useFeriados } from './hooks/useFeriados';

import FiltrosAgenda from './components/FiltrosAgenda';
import CalendarioGrade from './components/CalendarioGrade';
import ModalAgendamento from './components/ModalAgendamento';
import ModalNovaAula from './components/ModalNovaAula';
import ModalListaPresenca from './components/ModalListaPresenca';
import ModalFeriados from './components/ModalFeriados';
import ModalAcoesEvento from './components/ModalAcoesEvento';

const INITIAL_FORM_STATE = { 
  id: null, atividade: '', modalidade_id: '', professor_id: '', dia_semana: 'Segunda-feira', 
  horario: '', capacidade: 15, eh_recorrente: true, data_especifica: '', espaco: 'funcional',
  valor_por_aluno: '', cor: 'laranja'
};

export default function Agenda() {
  const { perfil } = useOutletContext();
  const isAdmin = perfil === 'admin';

  // 1. Estados e Hooks Extraídos
  const [atualizarPresencas, setAtualizarPresencas] = useState(0);
  const [novaAula, setNovaAula] = useState(INITIAL_FORM_STATE);
  const [eventoSelecionado, setEventoSelecionado] = useState(null);
  const [aulaParaLista, setAulaParaLista] = useState(null);
  const [dataLista, setDataLista] = useState(new Date().toISOString().split('T')[0]);
  
  const [dadosIniciais, setDadosIniciais] = useState({ professores: [], modalidades: [], matriculasFixas: [] });
  
  const { aulas, feriados, loading, refetch } = useAgenda();
  const { alunos: listaAlunos } = useAlunos({ role: 'aluno' });
  const pageState = useAgendaPage();
  const dadosMes = useAgendaDadosMes(pageState.currentDate, atualizarPresencas);

  // 2. Modais
  const modais = {
    novaAula: useModal(), agendamento: useModal(), lista: useModal(), 
    acoesEvento: useModal(), feriados: useModal(), excluir: useModal(), encerrar: useModal()
  };

  // 3. Handlers de Domínio
  const hookAgendamento = useAgendamento(() => { modais.agendamento.fechar(); setAtualizarPresencas(prev => prev + 1); }, feriados);
  const hookLista = useListaPresenca(aulaParaLista, dataLista, modais.lista.isOpen, () => setAtualizarPresencas(prev => prev + 1));
  const hookFeriados = useFeriados(refetch);
  const eventosCalendario = useEventosCalendario({ aulas, feriados, ...dadosMes, matriculasFixas: dadosIniciais.matriculasFixas, ...pageState });

  const mutations = useGradeMutations({
    onSuccess: () => {
      Object.values(modais).forEach(m => m.isOpen && m.fechar());
      refetch();
    }
  });

  // 4. Efeitos
  useEffect(() => {
    Promise.all([gradeService.listarProfessores(), gradeService.listarModalidades(), gradeService.listarMatriculasFixas()])
      .then(([professores, modalidades, matriculasFixas]) => setDadosIniciais({ professores: professores||[], modalidades: modalidades||[], matriculasFixas: matriculasFixas||[] }))
      .catch(console.error);
  }, []);

  const handleSelectSlot = ({ start }) => {
    if (!isAdmin) return;
    const dataStr = format(start, 'yyyy-MM-dd');
    const ehFeriado = feriados.find(f => f.data === dataStr && f.bloqueia_agenda);
    if (ehFeriado) return showToast.error(`Data bloqueada: ${ehFeriado.descricao}`);

    const dia = format(start, 'eeee', { locale: ptBR });
    setNovaAula({ ...INITIAL_FORM_STATE, horario: format(start, 'HH:mm'), dia_semana: dia.charAt(0).toUpperCase() + dia.slice(1), data_especifica: dataStr });
    modais.novaAula.abrir();
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500 min-h-screen flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Grade de Aulas</h1>
          <p className="text-gray-500 font-medium">Visualize e organize a agenda do estúdio.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {isAdmin && <button onClick={modais.feriados.abrir} className="bg-gray-100 text-gray-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-200 transition-colors"><Ban size={20} /> Bloqueios ({feriados.length})</button>}
          <button onClick={() => { hookAgendamento.setAgendamentoForm({...hookAgendamento.agendamentoForm, aula_id: '', data_aula: ''}); modais.agendamento.abrir(); }} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold flex gap-2"><UserCheck size={20} /> {isAdmin ? "Agendar na Turma" : "Agendar Aluno"}</button>
          {isAdmin && <button onClick={() => { setNovaAula(INITIAL_FORM_STATE); modais.novaAula.abrir(); }} className="bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-bold flex gap-2"><Plus size={20} /> Nova Aula</button>}
        </div>
      </div>

      <FiltrosAgenda {...pageState} professores={dadosIniciais.professores} isAdmin={isAdmin} />

      <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm" style={{ height: '750px' }}>
        {loading ? <TableSkeleton /> : (
          <CalendarioGrade 
            eventos={eventosCalendario} currentDate={pageState.currentDate} setCurrentDate={pageState.setCurrentDate}
            currentView={pageState.currentView} setCurrentView={pageState.setCurrentView}
            handleSelectSlot={handleSelectSlot}
            handleSelectEvent={(ev) => { ev.isFeriado ? showToast.error(`Dia bloqueado: ${ev.dadosOriginais.descricao}`) : (setEventoSelecionado(ev), modais.acoesEvento.abrir()); }}
          />
        )}
      </div>

      <Modal isOpen={modais.agendamento.isOpen} onClose={modais.agendamento.fechar} titulo="Agendamento"><ModalAgendamento {...hookAgendamento} aulas={aulas} listaAlunos={listaAlunos} /></Modal>
      <Modal isOpen={modais.novaAula.isOpen} onClose={modais.novaAula.fechar} titulo={novaAula.id ? "Editar Atividade" : "Nova Aula"}><ModalNovaAula novaAula={novaAula} setNovaAula={setNovaAula} modalidades={dadosIniciais.modalidades} professores={dadosIniciais.professores} savingAula={mutations.savingAula} salvarAula={(e) => { e.preventDefault(); mutations.salvarAula(novaAula); }} /></Modal>
      <Modal isOpen={modais.lista.isOpen} onClose={modais.lista.fechar} titulo="Chamada"><ModalListaPresenca {...hookLista} aulaParaLista={aulaParaLista} dataLista={dataLista} setDataLista={setDataLista} /></Modal>
      {isAdmin && <Modal isOpen={modais.feriados.isOpen} onClose={modais.feriados.fechar} titulo="Gerenciar Bloqueios (Feriados)"><ModalFeriados feriados={feriados} {...hookFeriados} /></Modal>}

      <Modal isOpen={modais.acoesEvento.isOpen} onClose={modais.acoesEvento.fechar} titulo="Detalhes da Aula">
        <ModalAcoesEvento 
          evento={eventoSelecionado} isAdmin={isAdmin}
          onAgendar={(ev) => { modais.acoesEvento.fechar(); hookAgendamento.setAgendamentoForm({tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: ev.dadosOriginais.id, data_aula: format(ev.start, 'yyyy-MM-dd')}); modais.agendamento.abrir(); }}
          onChamada={(ev) => { modais.acoesEvento.fechar(); setAulaParaLista(ev.dadosOriginais); setDataLista(format(ev.start, 'yyyy-MM-dd')); modais.lista.abrir(); }}
          onEditar={(ev) => { modais.acoesEvento.fechar(); setNovaAula({...ev.dadosOriginais}); modais.novaAula.abrir(); }}
          onEncerrar={() => modais.encerrar.abrir()}
          onExcluir={() => modais.excluir.abrir()}
        />
      </Modal>

      <ModalConfirmacao isOpen={modais.excluir.isOpen} onClose={modais.excluir.fechar} onConfirm={() => mutations.excluirAula(eventoSelecionado.dadosOriginais.id)} titulo="Excluir Grade Permanentemente" mensagem={`Atenção: Ao confirmar, todas as aulas e presenças desta grade serão apagadas. Esta ação NÃO pode ser desfeita.`} tipo="danger" />
      <ModalConfirmacao isOpen={modais.encerrar.isOpen} onClose={modais.encerrar.fechar} onConfirm={() => mutations.encerrarAula(eventoSelecionado.dadosOriginais.id, eventoSelecionado.start)} titulo="Encerrar Turma" mensagem={`O histórico será mantido, mas esta turma não aparecerá mais a partir de ${eventoSelecionado ? format(eventoSelecionado.start, 'dd/MM/yyyy') : ''}. Confirma?`} tipo="warning" />
    </div>
  );
}