import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Ban, Trash2, Edit2, RefreshCw, 
  Dumbbell, Music, UserCheck, Users, XCircle, ChevronLeft, ChevronRight, Palette
} from 'lucide-react';

import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, endOfWeek, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { agendaService } from '../services/agendaService';
import { useAgenda } from '../hooks/useAgenda';
import { useAlunos } from '../hooks/useAlunos';

import { DIAS_SEMANA } from '../lib/constants';
import { showToast } from '../components/shared/Toast';
import Modal, { useModal } from '../components/shared/Modal';
import { TableSkeleton } from '../components/shared/Loading';

const locales = { 'pt-BR': ptBR };
const localizer = dateFnsLocalizer({
  format, parse, startOfWeek, getDay, locales,
});

const PALETA_CORES = [
  { id: 'laranja', bg: '#ffedd5', text: '#c2410c', border: '#f97316' },
  { id: 'roxo', bg: '#f3e8ff', text: '#7e22ce', border: '#a855f7' },
  { id: 'verde', bg: '#dcfce7', text: '#15803d', border: '#22c55e' },
  { id: 'azul', bg: '#dbeafe', text: '#1d4ed8', border: '#3b82f6' },
  { id: 'rosa', bg: '#fce7f3', text: '#be185d', border: '#ec4899' },
  { id: 'amarelo', bg: '#fef3c7', text: '#b45309', border: '#f59e0b' },
  { id: 'cinza', bg: '#f3f4f6', text: '#374151', border: '#9ca3af' },
];

const formatosCalendario = {
  timeGutterFormat: 'HH:mm',
  eventTimeRangeFormat: () => '', 
  agendaTimeRangeFormat: ({ start, end }, culture, localizer) =>
    `${localizer.format(start, 'HH:mm', culture)} - ${localizer.format(end, 'HH:mm', culture)}`,
  dayHeaderFormat: 'EEEE, dd/MM',
  dayRangeHeaderFormat: ({ start, end }, culture, localizer) =>
    `${localizer.format(start, 'dd/MM', culture)} - ${localizer.format(end, 'dd/MM', culture)}`,
};

export default function Agenda() {
  const initialFormState = { 
    id: null, atividade: '', modalidade_id: '', professor_id: '', dia_semana: 'Segunda-feira', 
    horario: '', capacidade: 15, eh_recorrente: true, data_especifica: '', espaco: 'funcional',
    valor_por_aluno: '', cor: 'laranja'
  };

  const [novaAula, setNovaAula] = useState(initialFormState);
  const [agendamentoForm, setAgendamentoForm] = useState({ aluno_id: '', aula_id: '', data_aula: '' });
  const [novoFeriado, setNovoFeriado] = useState({ data: '', descricao: '' });

  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState('week');
  
  const [atualizarPresencas, setAtualizarPresencas] = useState(0);
  const [presencasCalendario, setPresencasCalendario] = useState([]);

  const [filtroProf, setFiltroProf] = useState('todos');
  const [filtroEspaco, setFiltroEspaco] = useState('todos'); 
  
  const [savingAula, setSavingAula] = useState(false);
  const [savingAgendamento, setSavingAgendamento] = useState(false);
  const [savingFeriado, setSavingFeriado] = useState(false);
  
  const [eventoSelecionado, setEventoSelecionado] = useState(null);
  const [aulaParaLista, setAulaParaLista] = useState(null);
  const [dataLista, setDataLista] = useState(new Date().toISOString().split('T')[0]);
  const [listaPresenca, setListaPresenca] = useState([]);
  const [loadingLista, setLoadingLista] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);
  
  const [professores, setProfessores] = useState([]);
  const [modalidades, setModalidades] = useState([]);

  const { aulas, feriados, loading, refetch } = useAgenda();
  const { alunos: listaAlunos } = useAlunos({ role: 'aluno' }); 

  const modalNovaAula = useModal();
  const modalAgendamento = useModal();
  const modalLista = useModal();
  const modalAcoesEvento = useModal();
  const modalFeriados = useModal();

  useEffect(() => {
    async function carregarDadosIniciais() {
      try {
        const [profData, modData] = await Promise.all([
          agendaService.listarProfessores(),
          agendaService.listarModalidades()
        ]);
        setProfessores(profData || []);
        setModalidades(modData || []);
      } catch (error) {}
    }
    carregarDadosIniciais();
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function carregarPresencasDoMes() {
      const inicio = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().split('T')[0];
      const fim = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];
      try {
        const dados = await agendaService.listarPresencasPeriodo(inicio, fim);
        if (isMounted) setPresencasCalendario(dados || []);
      } catch (error) {}
    }
    carregarPresencasDoMes();
    return () => { isMounted = false; };
  }, [currentDate.getMonth(), currentDate.getFullYear(), atualizarPresencas]);

  useEffect(() => {
    async function buscarLista() {
      if (modalLista.isOpen && aulaParaLista && dataLista) {
        setLoadingLista(true);
        try {
          const presencas = await agendaService.listarPresencas(aulaParaLista.id, dataLista);
          setListaPresenca(presencas || []);
        } finally {
          setLoadingLista(false);
        }
      }
    }
    buscarLista();
  }, [modalLista.isOpen, aulaParaLista, dataLista, atualizarPresencas]);

  const eventosCalendario = useMemo(() => {
    if (!aulas) return [];

    const presencasMap = {};
    presencasCalendario.forEach(p => {
      const dataStr = p.data_checkin.split('T')[0];
      const key = `${p.aula_id}-${dataStr}`;
      if (!presencasMap[key]) presencasMap[key] = [];
      if (p.alunos?.nome_completo) {
        presencasMap[key].push(p.alunos.nome_completo);
      }
    });

    const diasMapa = {
      'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2, 'Quarta-feira': 3,
      'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6
    };

    let eventosGerados = [];
    
    let inicioVisivel, fimVisivel;
    if (currentView === 'day') {
      inicioVisivel = currentDate;
      fimVisivel = currentDate;
    } else if (currentView === 'week') {
      inicioVisivel = startOfWeek(currentDate, { weekStartsOn: 0 });
      fimVisivel = endOfWeek(currentDate, { weekStartsOn: 0 });
    } else {
      inicioVisivel = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      fimVisivel = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    }

    const aulasFiltradas = aulas.filter(aula => {
      const matchProf = filtroProf === 'todos' || String(aula.professor_id) === String(filtroProf);
      const espacoAula = aula.espaco || 'funcional'; 
      const matchEspaco = filtroEspaco === 'todos' || espacoAula === filtroEspaco;
      return matchProf && matchEspaco;
    });

    aulasFiltradas.forEach(aula => {
      const [hora, minuto] = aula.horario.split(':').map(Number);

      if (aula.eh_recorrente) {
        const diaAlvo = diasMapa[aula.dia_semana];
        
        let iterador = new Date(inicioVisivel);
        iterador.setHours(0, 0, 0, 0);
        const limite = new Date(fimVisivel);
        limite.setHours(23, 59, 59, 999);

        let safetyCounter = 0;
        while (iterador <= limite && safetyCounter < 50) {
          if (iterador.getDay() === diaAlvo) {
            const inicio = new Date(iterador);
            inicio.setHours(hora, minuto, 0);
            const fim = new Date(inicio);
            fim.setHours(hora + 1, minuto, 0); 
            
            const dataStr = format(inicio, 'yyyy-MM-dd');
            const alunosAgendados = presencasMap[`${aula.id}-${dataStr}`] || [];

            eventosGerados.push({
              idUnico: `${aula.id}-${dataStr}`,
              title: aula.atividade,
              start: inicio, end: fim,
              dadosOriginais: aula,
              isEventoLivre: false,
              alunosAgendados
            });
          }
          iterador = addDays(iterador, 1);
          safetyCounter++;
        }
      } else if (aula.data_especifica) {
        const [ano, mes, dia] = aula.data_especifica.split('-');
        const inicio = new Date(ano, mes - 1, dia, hora, minuto);
        const fim = new Date(inicio);
        fim.setHours(hora + 1, minuto, 0);

        const alunosAgendados = presencasMap[`${aula.id}-${aula.data_especifica}`] || [];

        eventosGerados.push({
          idUnico: `${aula.id}-unico`,
          title: `⭐ ${aula.atividade}`,
          start: inicio, end: fim,
          dadosOriginais: aula,
          isEventoLivre: true,
          alunosAgendados
        });
      }
    });

    return eventosGerados;
  }, [aulas, filtroProf, filtroEspaco, currentDate, currentView, presencasCalendario]);

  function handleSelectSlot({ start }) {
    const diaSemanaTexto = format(start, 'eeee', { locale: ptBR });
    const diaCapitalizado = diaSemanaTexto.charAt(0).toUpperCase() + diaSemanaTexto.slice(1);
    setNovaAula({ 
      ...initialFormState, 
      horario: format(start, 'HH:mm'), dia_semana: diaCapitalizado, data_especifica: format(start, 'yyyy-MM-dd')
    });
    modalNovaAula.abrir();
  }

  function handleSelectEvent(evento) {
    setEventoSelecionado(evento);
    modalAcoesEvento.abrir();
  }

  function eventPropGetter(event) {
    const corDB = event.dadosOriginais.cor || 'laranja';
    const corTema = PALETA_CORES.find(c => c.id === corDB) || PALETA_CORES[0];

    return {
      style: {
        backgroundColor: corTema.bg,
        color: corTema.text,
        border: '1px solid white', 
        borderLeft: `5px solid ${corTema.border}`,
        borderRadius: '6px',
        padding: '2px 6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        cursor: 'pointer',
      }
    };
  }

  const CustomToolbar = (toolbar) => {
    const goToBack = () => toolbar.onNavigate('PREV');
    const goToNext = () => toolbar.onNavigate('NEXT');
    const goToCurrent = () => toolbar.onNavigate('TODAY');

    return (
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={goToCurrent} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm transition-colors">Hoje</button>
          <div className="flex gap-1 bg-gray-50 rounded-xl p-1 border border-gray-100">
            <button onClick={goToBack} className="p-2 hover:bg-white rounded-lg text-gray-500 transition-colors shadow-sm"><ChevronLeft size={18}/></button>
            <button onClick={goToNext} className="p-2 hover:bg-white rounded-lg text-gray-500 transition-colors shadow-sm"><ChevronRight size={18}/></button>
          </div>
        </div>
        <h2 className="text-lg font-black text-gray-800 capitalize tracking-wide">{toolbar.label}</h2>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          <button onClick={() => toolbar.onView('month')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${toolbar.view === 'month' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Mês</button>
          <button onClick={() => toolbar.onView('week')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${toolbar.view === 'week' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Semana</button>
          <button onClick={() => toolbar.onView('day')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${toolbar.view === 'day' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Dia</button>
        </div>
      </div>
    );
  };

  const CustomEventCard = ({ event }) => (
    <div className="h-full flex flex-col overflow-hidden relative pointer-events-none">
      <div className="font-bold text-[11px] leading-tight mb-1 truncate">{event.title}</div>
      {event.alunosAgendados && event.alunosAgendados.length > 0 && (
        <div className="flex flex-col gap-[2px] mt-1">
          {event.alunosAgendados.slice(0, 6).map((aluno, idx) => (
            <div key={idx} className="text-[9px] bg-white/50 px-1 rounded truncate flex items-center gap-1 font-medium">
              <div className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0"></div>
              {aluno.split(' ')[0]}
            </div>
          ))}
          {event.alunosAgendados.length > 6 && (
            <div className="text-[9px] bg-white/70 font-bold px-1 rounded text-center mt-[2px]">
              + {event.alunosAgendados.length - 6}
            </div>
          )}
        </div>
      )}
    </div>
  );

  async function salvarAula(e) {
    e.preventDefault();
    if (savingAula) return;
    setSavingAula(true);

    try {
      const payload = {
        atividade: novaAula.atividade, 
        modalidade_id: novaAula.modalidade_id || null,
        professor_id: novaAula.professor_id,
        horario: novaAula.horario, 
        capacidade: Number(novaAula.capacidade),
        eh_recorrente: novaAula.eh_recorrente, 
        espaco: novaAula.espaco, 
        ativa: true,
        valor_por_aluno: Number(novaAula.valor_por_aluno) || 0,
        cor: novaAula.cor || 'laranja'
      };

      if (novaAula.id) payload.id = novaAula.id;

      if (novaAula.eh_recorrente) {
        payload.dia_semana = novaAula.dia_semana; payload.data_especifica = null; 
        if (!payload.modalidade_id) throw new Error("Selecione uma Modalidade da lista para aulas recorrentes.");
      } else {
        if (!novaAula.data_especifica) throw new Error("Data é obrigatória para evento único");
        payload.data_especifica = novaAula.data_especifica;
        const diaCalculado = format(new Date(novaAula.data_especifica + 'T12:00:00'), 'eeee', { locale: ptBR });
        payload.dia_semana = diaCalculado.charAt(0).toUpperCase() + diaCalculado.slice(1);
      }

      await agendaService.salvarAula(payload);
      showToast.success(novaAula.id ? "Atividade atualizada!" : "Atividade agendada!");
      modalNovaAula.fechar();
      refetch();
    } catch (err) {
      showToast.error("Erro ao salvar: " + err.message);
    } finally {
      setSavingAula(false);
    }
  }

  async function excluirAula(id) {
    if (!confirm("Tem certeza que deseja excluir esta atividade de TODA a grade?")) return;
    try {
      await agendaService.excluirAula(id);
      showToast.success("Atividade removida com sucesso.");
      modalAcoesEvento.fechar();
      refetch();
    } catch (err) {
      showToast.error("Erro ao excluir.");
    }
  }

  async function handleAgendarAluno(e) {
    e.preventDefault();
    if (savingAgendamento) return;
    setSavingAgendamento(true);
    try {
      await agendaService.agendarAulaAdmin(agendamentoForm);
      showToast.success("Aluno agendado com sucesso!");
      setAgendamentoForm({ aluno_id: '', aula_id: '', data_aula: '' });
      modalAgendamento.fechar();
      setAtualizarPresencas(prev => prev + 1);
    } catch (err) {
      showToast.error("Erro ao agendar: " + (err.message || "Vagas esgotadas ou aluno já inscrito."));
    } finally {
      setSavingAgendamento(false);
    }
  }

  async function handleRemoverPresenca(presenca) {
    if (!confirm(`Tem certeza que deseja remover ${presenca.alunos?.nome_completo} desta aula?`)) return;
    setRemovendoId(presenca.id);
    try {
      await agendaService.cancelarAgendamento(presenca.id);
      showToast.success("Aluno removido da aula!");
      setListaPresenca(prev => prev.filter(p => p.id !== presenca.id));
      setAtualizarPresencas(prev => prev + 1);
    } catch (err) {
      showToast.error("Erro ao remover: " + err.message);
    } finally {
      setRemovendoId(null);
    }
  }

  async function salvarFeriado(e) {
    e.preventDefault();
    if (savingFeriado) return;
    setSavingFeriado(true);
    try {
      await agendaService.cadastrarFeriado(novoFeriado);
      showToast.success("Bloqueio adicionado na agenda!");
      setNovoFeriado({ data: '', descricao: '' });
      refetch();
    } catch (err) {
      showToast.error("Erro ao salvar bloqueio.");
    } finally {
      setSavingFeriado(false);
    }
  }

  async function deletarFeriado(id) {
    if (!confirm("Tem certeza que deseja remover este bloqueio?")) return;
    try {
      await agendaService.excluirFeriado(id);
      showToast.success("Bloqueio removido.");
      refetch();
    } catch (err) {
      showToast.error("Erro ao remover bloqueio.");
    }
  }

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500 min-h-screen flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Grade de Aulas</h1>
          <p className="text-gray-500">Visualize e organize a agenda do estúdio.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={modalFeriados.abrir} className="bg-gray-100 text-gray-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-200 transition-colors">
            <Ban size={20} /> Bloqueios ({feriados.length})
          </button>
          <button onClick={modalAgendamento.abrir} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 flex items-center gap-2 hover:bg-blue-700 hover:scale-[1.02] transition-all">
            <UserCheck size={20} /> Agendar Aluno
          </button>
          <button onClick={() => { setNovaAula(initialFormState); modalNovaAula.abrir(); }} className="bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-orange-200 flex items-center gap-2 hover:scale-[1.02] transition-all">
            <Plus size={20} /> Nova Aula
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-2 rounded-[24px] border border-gray-100 shadow-sm shrink-0">
        <div className="flex bg-gray-100 p-1 rounded-2xl w-full md:w-auto">
          <button onClick={() => setFiltroEspaco('todos')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${filtroEspaco === 'todos' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Todos</button>
          <button onClick={() => setFiltroEspaco('funcional')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'funcional' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-orange-500'}`}><Dumbbell size={16} /> Funcional</button>
          <button onClick={() => setFiltroEspaco('danca')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'danca' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-400 hover:text-purple-500'}`}><Music size={16} /> Dança</button>
        </div>

        <div className="flex items-center gap-2 pr-4 w-full md:w-auto">
          <span className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap px-2">Professor:</span>
          <select className="bg-gray-50 px-4 py-2 rounded-xl font-bold text-sm outline-none cursor-pointer w-full" value={filtroProf} onChange={e => setFiltroProf(e.target.value)}>
            <option value="todos">Todos</option>
            {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm" style={{ height: '750px' }}>
        {loading ? <TableSkeleton /> : (
          <div className="h-full style-calendar-wrapper">
             <style dangerouslySetInnerHTML={{__html: `
                .rbc-calendar { font-family: inherit; }
                .rbc-header { padding: 12px 0; font-weight: 900; color: #4b5563; text-transform: uppercase; font-size: 11px; border-bottom: 2px solid #f3f4f6; }
                .rbc-today { background-color: #fffaf5; }
                .rbc-time-view { border-radius: 16px; border-color: #f3f4f6; border-top: 1px solid #f3f4f6; }
                .rbc-timeslot-group { border-color: #f3f4f6; min-height: 60px; }
                .rbc-time-content { border-top: 2px solid #f3f4f6; }
                .rbc-time-gutter .rbc-timeslot-group { font-size: 11px; font-weight: bold; color: #9ca3af; }
             `}} />
            
            <Calendar
              localizer={localizer}
              formats={formatosCalendario}
              culture="pt-BR"
              events={eventosCalendario}
              startAccessor="start" endAccessor="end"
              date={currentDate} onNavigate={setCurrentDate}
              view={currentView} onView={setCurrentView}
              selectable={true}
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventPropGetter}
              style={{ height: '100%' }}
              components={{
                toolbar: CustomToolbar,
                event: CustomEventCard
              }}
              step={30} timeslots={2}
              min={new Date(0, 0, 0, 6, 0, 0)} max={new Date(0, 0, 0, 23, 0, 0)}
            />
          </div>
        )}
      </div>

      <Modal isOpen={modalAcoesEvento.isOpen} onClose={modalAcoesEvento.fechar} titulo="Detalhes da Aula">
        {eventoSelecionado && (() => {
          const corTema = PALETA_CORES.find(c => c.id === eventoSelecionado.dadosOriginais.cor) || PALETA_CORES[0];
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
              <button onClick={() => { modalAcoesEvento.fechar(); setAulaParaLista(eventoSelecionado.dadosOriginais); setDataLista(format(eventoSelecionado.start, 'yyyy-MM-dd')); setListaPresenca([]); modalLista.abrir(); }} className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-sm">
                <Users size={20} /> Ver Lista de Alunos Agendados
              </button>
              <div className="flex gap-3">
                <button onClick={() => { 
                    modalAcoesEvento.fechar(); 
                    setNovaAula({ 
                        id: eventoSelecionado.dadosOriginais.id, 
                        atividade: eventoSelecionado.dadosOriginais.atividade, 
                        modalidade_id: eventoSelecionado.dadosOriginais.modalidade_id || '',
                        professor_id: eventoSelecionado.dadosOriginais.professor_id, 
                        dia_semana: eventoSelecionado.dadosOriginais.dia_semana || 'Segunda-feira', 
                        horario: eventoSelecionado.dadosOriginais.horario, 
                        capacidade: eventoSelecionado.dadosOriginais.capacidade, 
                        eh_recorrente: eventoSelecionado.dadosOriginais.eh_recorrente, 
                        data_especifica: eventoSelecionado.dadosOriginais.data_especifica || '', 
                        espaco: eventoSelecionado.dadosOriginais.espaco || 'funcional', 
                        cor: eventoSelecionado.dadosOriginais.cor || 'laranja', 
                        valor_por_aluno: eventoSelecionado.dadosOriginais.valor_por_aluno || '' 
                    }); 
                    modalNovaAula.abrir(); 
                }} className="flex-1 bg-gray-100 text-gray-700 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200">
                  <Edit2 size={18} /> Editar
                </button>
                <button onClick={() => excluirAula(eventoSelecionado.dadosOriginais.id)} className="flex-1 bg-red-50 text-red-600 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100">
                  <Trash2 size={18} /> Excluir
                </button>
              </div>
            </div>
          </div>
        )})()}
      </Modal>

      <Modal isOpen={modalNovaAula.isOpen} onClose={modalNovaAula.fechar} titulo={novaAula.id ? "Editar Atividade" : "Agendar Atividade"}>
        <form onSubmit={salvarAula} className="space-y-4 pt-2">
            
            <div className="flex bg-gray-100 p-1 rounded-2xl mb-2">
                <button type="button" onClick={() => setNovaAula({...novaAula, eh_recorrente: true, data_especifica: ''})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${novaAula.eh_recorrente ? 'bg-white shadow-sm text-iluminus-terracota' : 'text-gray-400'}`}>Aula Recorrente</button>
                <button type="button" onClick={() => setNovaAula({...novaAula, eh_recorrente: false})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${!novaAula.eh_recorrente ? 'bg-white shadow-sm text-iluminus-terracota' : 'text-gray-400'}`}>Evento Único</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'funcional' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-gray-100 text-gray-400'}`}>
                <input type="radio" name="espaco" value="funcional" className="hidden" checked={novaAula.espaco === 'funcional'} onChange={() => setNovaAula({...novaAula, espaco: 'funcional'})} />
                <Dumbbell size={18} /> <span className="font-bold text-xs uppercase">Funcional</span>
              </label>
              <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'danca' ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-100 text-gray-400'}`}>
                <input type="radio" name="espaco" value="danca" className="hidden" checked={novaAula.espaco === 'danca'} onChange={() => setNovaAula({...novaAula, espaco: 'danca'})} />
                <Music size={18} /> <span className="font-bold text-xs uppercase">Dança</span>
              </label>
            </div>

            {/* Select Modalidades Recorrentes vs Input Eventos Únicos */}
            {novaAula.eh_recorrente ? (
                <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 font-bold text-gray-700" 
                    required 
                    value={novaAula.modalidade_id || ''} 
                    onChange={e => {
                        const val = e.target.value;
                        if (!val) {
                            setNovaAula({...novaAula, modalidade_id: '', atividade: '', professor_id: ''});
                            return;
                        }
                        const modSelecionada = modalidades.find(m => m.id === val);
                        setNovaAula({
                            ...novaAula, 
                            modalidade_id: modSelecionada.id, 
                            atividade: modSelecionada.nome,
                            professor_id: modSelecionada.professor_id || '' 
                        });
                    }}
                >
                    <option value="">Selecione a Modalidade Base...</option>
                    {modalidades.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
            ) : (
                <input 
                    placeholder="Nome do Evento Especial (Texto Livre)" 
                    className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700" 
                    required 
                    value={novaAula.atividade} 
                    onChange={e => setNovaAula({...novaAula, atividade: e.target.value, modalidade_id: ''})} 
                />
            )}
            
            {novaAula.espaco === 'danca' && (
              <input 
                type="number" 
                placeholder="Valor base por aluno (R$) - Opcional" 
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none border-purple-100 border focus:border-purple-300" 
                value={novaAula.valor_por_aluno} 
                onChange={e => setNovaAula({...novaAula, valor_por_aluno: e.target.value})} 
              />
            )}

            <div>
              <label className="text-xs font-black text-gray-400 uppercase flex items-center gap-2 mb-2"><Palette size={14}/> Cor no Calendário</label>
              <div className="flex gap-2">
                {PALETA_CORES.map(c => (
                  <button type="button" key={c.id} onClick={() => setNovaAula({...novaAula, cor: c.id})} className={`w-10 h-10 rounded-full border-4 transition-all hover:scale-110 ${novaAula.cor === c.id ? 'scale-110 shadow-md' : 'border-transparent'}`} style={{ backgroundColor: c.bg, borderColor: novaAula.cor === c.id ? c.border : 'transparent' }} title={c.id} />
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
            
            <button disabled={savingAula} className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black shadow-lg hover:scale-[1.01] transition-all flex items-center justify-center gap-2">
                {savingAula ? <RefreshCw className="animate-spin" size={20}/> : null}
                {savingAula ? "Salvando..." : (novaAula.id ? "Salvar Alterações" : "Salvar na Grade")}
            </button>
        </form>
      </Modal>

      <Modal isOpen={modalLista.isOpen} onClose={modalLista.fechar} titulo="Lista de Presença">
        {aulaParaLista && (
          <div className="space-y-4 pt-2 min-h-[300px]">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 flex flex-col gap-2">
              <h4 className="font-black text-gray-800">{aulaParaLista.atividade}</h4>
              <p className="text-xs text-gray-500 font-medium">Capacidade: {aulaParaLista.capacidade} vagas</p>
              <div className="mt-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Data da Aula</label>
                <input 
                  type="date" 
                  className="w-full p-2 bg-white rounded-lg outline-none border border-gray-200 focus:border-blue-500 font-bold text-gray-700"
                  value={dataLista} 
                  onChange={e => setDataLista(e.target.value)} 
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <h5 className="font-bold text-sm text-gray-700">Alunos Agendados ({listaPresenca.length})</h5>
              </div>

              {loadingLista ? (
                <div className="flex justify-center p-6"><RefreshCw className="animate-spin text-gray-300" size={24} /></div>
              ) : listaPresenca.length === 0 ? (
                <div className="text-center p-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <p className="text-sm text-gray-400 font-medium">Nenhum aluno agendado para esta data.</p>
                </div>
              ) : (
                <ul className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                  {listaPresenca.map(presenca => (
                    <li key={presenca.id} className="p-3 bg-white border border-gray-100 rounded-xl shadow-sm flex items-center justify-between hover:border-red-100 transition-colors">
                      <span className="font-bold text-gray-700 text-sm">{presenca.alunos?.nome_completo}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded-md font-bold uppercase tracking-wider">Confirmado</span>
                        <button
                          onClick={() => handleRemoverPresenca(presenca)}
                          disabled={removendoId === presenca.id}
                          className="text-gray-400 hover:text-red-500 p-1.5 bg-gray-50 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          {removendoId === presenca.id ? (
                            <RefreshCw size={16} className="animate-spin text-red-500" />
                          ) : (
                            <XCircle size={16} />
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={modalFeriados.isOpen} onClose={modalFeriados.fechar} titulo="Gerenciar Bloqueios (Feriados)">
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
                    <button onClick={() => deletarFeriado(f.id)} className="p-2 hover:bg-red-100 rounded-lg transition-colors text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={modalAgendamento.isOpen} onClose={modalAgendamento.fechar} titulo="Agendar Aluno Manualmente">
        <form onSubmit={handleAgendarAluno} className="space-y-4 pt-2">
          <select required className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 transition-colors" value={agendamentoForm.aluno_id} onChange={e => setAgendamentoForm({...agendamentoForm, aluno_id: e.target.value})}>
            <option value="">Selecione o aluno...</option>
            {listaAlunos.map(a => <option key={a.id} value={a.id}>{a.nome_completo}</option>)}
          </select>
          <select required className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 transition-colors" value={agendamentoForm.aula_id} onChange={e => setAgendamentoForm({...agendamentoForm, aula_id: e.target.value})}>
            <option value="">Selecione a aula da grade...</option>
            {aulas.map(aula => <option key={aula.id} value={aula.id}>{aula.atividade} - {aula.eh_recorrente ? aula.dia_semana : 'Evento Único'}</option>)}
          </select>
          <input type="date" required className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 transition-colors" value={agendamentoForm.data_aula} onChange={e => setAgendamentoForm({...agendamentoForm, data_aula: e.target.value})} />
          <button disabled={savingAgendamento} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg flex items-center justify-center gap-2">Confirmar Agendamento</button>
        </form>
      </Modal>

    </div>
  );
}