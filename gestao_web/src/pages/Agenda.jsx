import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Ban, Trash2, Edit2, RefreshCw, UserPlus,
  Dumbbell, Music, UserCheck, Users, XCircle, ChevronLeft, ChevronRight, Palette
} from 'lucide-react';

// IMPORTAÇÃO NOVA PARA PEGAR O PERFIL LOGADO
import { useOutletContext } from 'react-router-dom';

import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, endOfWeek, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { agendaService } from '../services/agendaService';
import { useAgenda } from '../hooks/useAgenda';
import { useAlunos } from '../hooks/useAlunos';
import { supabase } from '../lib/supabase';

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
  // AQUI PEGAMOS O PERFIL (admin ou professor)
  const { perfil } = useOutletContext();
  const isAdmin = perfil === 'admin';

  const initialFormState = { 
    id: null, atividade: '', modalidade_id: '', professor_id: '', dia_semana: 'Segunda-feira', 
    horario: '', capacidade: 15, eh_recorrente: true, data_especifica: '', espaco: 'funcional',
    valor_por_aluno: '', cor: 'laranja'
  };

  const [novaAula, setNovaAula] = useState(initialFormState);
  
  const [agendamentoForm, setAgendamentoForm] = useState({ tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: '', data_aula: '' });
  
  const [novoFeriado, setNovoFeriado] = useState({ data: '', descricao: '' });

  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState('week');
  
  const [atualizarPresencas, setAtualizarPresencas] = useState(0);
  
  const [presencasCalendario, setPresencasCalendario] = useState([]); 
  const [matriculasFixas, setMatriculasFixas] = useState([]); 
  const [excecoesCalendario, setExcecoesCalendario] = useState([]); 

  const [filtroProf, setFiltroProf] = useState('todos');
  const [filtroEspaco, setFiltroEspaco] = useState('todos'); 
  
  const [savingAula, setSavingAula] = useState(false);
  const [savingAgendamento, setSavingAgendamento] = useState(false);
  const [savingFeriado, setSavingFeriado] = useState(false);
  
  // ESTADOS DO FEEDBACK AO VIVO
  const [infoVaga, setInfoVaga] = useState(null);
  const [verificandoVaga, setVerificandoVaga] = useState(false);
  
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
        const [profData, modData, fixasData] = await Promise.all([
          agendaService.listarProfessores(),
          agendaService.listarModalidades(),
          agendaService.listarMatriculasFixas() 
        ]);
        setProfessores(profData || []);
        setModalidades(modData || []);
        setMatriculasFixas(fixasData || []);
      } catch (error) {}
    }
    carregarDadosIniciais();
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function carregarDadosDoMes() {
      const inicio = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().split('T')[0];
      const fim = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];
      try {
        const [dadosAvulsos, dadosExcecoes] = await Promise.all([
           agendaService.listarPresencasPeriodo(inicio, fim),
           supabase.from('agenda_excecoes').select('*').gte('data_especifica', inicio).lte('data_especifica', fim)
        ]);
        if (isMounted) {
            setPresencasCalendario(dadosAvulsos || []);
            setExcecoesCalendario(dadosExcecoes.data || []);
        }
      } catch (error) {}
    }
    carregarDadosDoMes();
    return () => { isMounted = false; };
  }, [currentDate.getMonth(), currentDate.getFullYear(), atualizarPresencas]);

  useEffect(() => {
    async function buscarLista() {
      if (modalLista.isOpen && aulaParaLista && dataLista) {
        setLoadingLista(true);
        try {
          const presencas = await agendaService.listarChamadaCompleta(aulaParaLista.id, dataLista);
          setListaPresenca(presencas || []);
        } finally {
          setLoadingLista(false);
        }
      }
    }
    buscarLista();
  }, [modalLista.isOpen, aulaParaLista, dataLista, atualizarPresencas]);

  // EFEITO DO FEEDBACK AO VIVO NO MODAL
  useEffect(() => {
    async function checarDisponibilidadeLive() {
      if (agendamentoForm.aula_id && agendamentoForm.data_aula) {
        setVerificandoVaga(true);
        const alunoIdParaChecar = agendamentoForm.tipo === 'cadastrado' ? agendamentoForm.aluno_id : null;
        const info = await agendaService.verificarDisponibilidade(agendamentoForm.aula_id, agendamentoForm.data_aula, alunoIdParaChecar);
        setInfoVaga(info);
        setVerificandoVaga(false);
      } else {
        setInfoVaga(null);
      }
    }
    checarDisponibilidadeLive();
  }, [agendamentoForm.aula_id, agendamentoForm.data_aula, agendamentoForm.aluno_id, agendamentoForm.tipo]);

  const eventosCalendario = useMemo(() => {
    if (!aulas) return [];

    const presencasMap = {};
    presencasCalendario.forEach(p => {
      const dataStr = p.data_checkin.split('T')[0];
      const key = `${p.aula_id}-${dataStr}`;
      if (!presencasMap[key]) presencasMap[key] = [];
      
      const nomeExibicao = p.nome_visitante || p.alunos?.nome_completo;
      if (nomeExibicao) {
        presencasMap[key].push(nomeExibicao);
      }
    });

    const fixasMap = {};
    matriculasFixas.forEach(m => {
       if (!fixasMap[m.aula_id]) fixasMap[m.aula_id] = [];
       if (m.alunos?.nome_completo) {
           fixasMap[m.aula_id].push({ 
               id: m.alunos.id, 
               nome: m.alunos.nome_completo,
               inicio: m.alunos.data_inicio_plano, 
               fim: m.alunos.data_fim_plano        
           });
       }
    });

    const excecoesMap = {};
    excecoesCalendario.forEach(e => {
        excecoesMap[`${e.aluno_id}-${e.aula_id}-${e.data_especifica}`] = true;
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
      const todosFixosDaTurma = fixasMap[aula.id] || []; 

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
            
            const fixosPresentesHoje = todosFixosDaTurma
                .filter(aluno => {
                    if (excecoesMap[`${aluno.id}-${aula.id}-${dataStr}`]) return false;
                    if (aluno.inicio && dataStr < aluno.inicio) return false;
                    if (aluno.fim && dataStr > aluno.fim) return false;
                    return true;
                })
                .map(a => a.nome);

            const alunosAvulsos = presencasMap[`${aula.id}-${dataStr}`] || [];
            const todosAlunos = [...new Set([...fixosPresentesHoje, ...alunosAvulsos])];

            eventosGerados.push({
              idUnico: `${aula.id}-${dataStr}`,
              title: aula.atividade,
              start: inicio, end: fim,
              dadosOriginais: aula,
              isEventoLivre: false,
              alunosAgendados: todosAlunos
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

        const fixosPresentesHoje = todosFixosDaTurma
                .filter(aluno => {
                    if (excecoesMap[`${aluno.id}-${aula.id}-${aula.data_especifica}`]) return false;
                    if (aluno.inicio && aula.data_especifica < aluno.inicio) return false;
                    if (aluno.fim && aula.data_especifica > aluno.fim) return false;
                    return true;
                })
                .map(a => a.nome);

        const alunosAvulsos = presencasMap[`${aula.id}-${aula.data_especifica}`] || [];
        const todosAlunos = [...new Set([...fixosPresentesHoje, ...alunosAvulsos])];

        eventosGerados.push({
          idUnico: `${aula.id}-unico`,
          title: `⭐ ${aula.atividade}`,
          start: inicio, end: fim,
          dadosOriginais: aula,
          isEventoLivre: true,
          alunosAgendados: todosAlunos
        });
      }
    });

    return eventosGerados;
  }, [aulas, filtroProf, filtroEspaco, currentDate, currentView, presencasCalendario, matriculasFixas, excecoesCalendario]);

  function handleSelectSlot({ start }) {
    // BLOQUEIO: Professores não podem criar novas turmas clicando na grade vazia
    if (!isAdmin) {
      showToast.warning("Apenas a gestão pode criar novas turmas na grade.");
      return;
    }

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
      <div className="font-bold text-[11px] leading-tight mb-1 shrink-0">{event.title}</div>
      {event.alunosAgendados && event.alunosAgendados.length > 0 && (
        <div className="flex flex-col gap-[2px] mt-1 overflow-hidden">
          {event.alunosAgendados.slice(0, 3).map((aluno, idx) => (
            <div key={idx} className="text-[9px] bg-white/50 px-1 rounded truncate flex items-center gap-1 font-medium">
              <div className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0"></div>
              {aluno.split(' ')[0]}
            </div>
          ))}
          {event.alunosAgendados.length > 3 && (
            <div className="text-[9px] bg-white/70 font-bold px-1 rounded text-center mt-[2px] shrink-0">
              + {event.alunosAgendados.length - 3} alunos
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

  async function handleAgendarAluno(e, ignorarAvisos = false) {
    if (e) e.preventDefault();
    if (savingAgendamento) return;
    setSavingAgendamento(true);
    
    try {
      await agendaService.agendarAulaAdmin({ ...agendamentoForm, ignorarAvisos });
      
      showToast.success("Agendamento realizado com sucesso!");
      setAgendamentoForm({ tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: '', data_aula: '' });
      modalAgendamento.fechar();
      setAtualizarPresencas(prev => prev + 1);
      
    } catch (err) {
      const msgErro = err.message || "";
      
      if (msgErro.includes("lotada") || msgErro.includes("limite do plano")) {
         const desejaForcar = window.confirm(`⚠️ AVISO DO SISTEMA:\n\n${msgErro}`);
         
         if (desejaForcar) {
            setSavingAgendamento(false);
            return handleAgendarAluno(null, true); 
         }
      } else {
         showToast.error("Erro ao agendar: " + msgErro);
      }
    } finally {
      setSavingAgendamento(false);
    }
  }

  async function handleRemoverPresenca(idRelacao) {
    if (!confirm(`Tem certeza que deseja remover este aluno?`)) return;
    setRemovendoId(idRelacao);
    try {
      await agendaService.cancelarAgendamento(idRelacao); 
      showToast.success("Aluno removido da lista!");
      setAtualizarPresencas(prev => prev + 1);
    } catch (err) {
      showToast.error("Erro ao remover: " + err.message);
    } finally {
      setRemovendoId(null);
    }
  }

  async function handleRegistrarFalta(aluno) {
    try {
      await agendaService.registrarFalta(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta informada. Aluno removido do card.");
      setAtualizarPresencas(prev => prev + 1);
    } catch (err) {
      showToast.error("Erro ao registrar falta.");
    }
  }

  async function handleDesfazerFalta(aluno) {
    try {
      await agendaService.removerFalta(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta removida.");
      setAtualizarPresencas(prev => prev + 1);
    } catch (err) {
      showToast.error("Erro ao remover falta.");
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
          
          {/* BOTÕES ESCONDIDOS SE NÃO FOR ADMIN */}
          {isAdmin && (
            <button onClick={modalFeriados.abrir} className="bg-gray-100 text-gray-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-200 transition-colors">
              <Ban size={20} /> Bloqueios ({feriados.length})
            </button>
          )}
          
          <button onClick={() => { setAgendamentoForm({...agendamentoForm, aula_id: '', data_aula: ''}); modalAgendamento.abrir(); }} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 flex items-center gap-2 hover:bg-blue-700 hover:scale-[1.02] transition-all">
            <UserCheck size={20} /> {isAdmin ? "Agendar na Turma" : "Agendar Aluno"}
          </button>
          
          {isAdmin && (
            <button onClick={() => { setNovaAula(initialFormState); modalNovaAula.abrir(); }} className="bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-orange-200 flex items-center gap-2 hover:scale-[1.02] transition-all">
              <Plus size={20} /> Nova Aula
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-2 rounded-[24px] border border-gray-100 shadow-sm shrink-0">
        <div className="flex bg-gray-100 p-1 rounded-2xl w-full md:w-auto">
          <button onClick={() => setFiltroEspaco('todos')} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${filtroEspaco === 'todos' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Todos</button>
          <button onClick={() => setFiltroEspaco('funcional')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'funcional' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-orange-500'}`}><Dumbbell size={16} /> Funcional</button>
          <button onClick={() => setFiltroEspaco('danca')} className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'danca' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-400 hover:text-purple-500'}`}><Music size={16} /> Dança</button>
        </div>

        {/* O PROFESSOR NÃO PRECISA FILTRAR POR PROFESSOR POIS ELE SÓ VÊ O DELE */}
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

                @media (max-width: 768px) {
                  .rbc-calendar { min-width: 600px; } 
                  .style-calendar-wrapper { overflow-x: auto; padding-bottom: 20px; } 
                  .rbc-time-header-content { font-size: 10px; }
                  .rbc-event { padding: 1px 2px !important; }
                  .rbc-toolbar { flex-direction: column; gap: 1rem; align-items: stretch !important; }
                  .rbc-toolbar h2 { text-align: center; font-size: 1.1rem; }
                }
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
              min={new Date(0, 0, 0, 6, 0, 0)} 
              max={new Date(0, 0, 0, 23, 0, 0)}
              scrollToTime={new Date(0, 0, 0, 6, 0, 0)}
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
              <button onClick={() => { 
                    modalAcoesEvento.fechar();
                    setAgendamentoForm({
                        tipo: 'cadastrado',
                        aluno_id: '',
                        nome_visitante: '',
                        aula_id: eventoSelecionado.dadosOriginais.id,
                        data_aula: format(eventoSelecionado.start, 'yyyy-MM-dd')
                    });
                    modalAgendamento.abrir();
              }} className="w-full bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-colors shadow-sm mb-2">
                <UserPlus size={20} /> Agendar Aluno Neste Horário
              </button>

              <button onClick={() => { modalAcoesEvento.fechar(); setAulaParaLista(eventoSelecionado.dadosOriginais); setDataLista(format(eventoSelecionado.start, 'yyyy-MM-dd')); setListaPresenca([]); modalLista.abrir(); }} className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-sm">
                <Users size={20} /> Fazer Chamada / Lista de Alunos
              </button>
              
              {/* EDIÇÃO E EXCLUSÃO SÓ APARECEM PARA ADMIN */}
              {isAdmin && (
                <div className="flex gap-3 mt-2">
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
                    <Edit2 size={18} /> Editar Grade
                  </button>
                  <button onClick={() => excluirAula(eventoSelecionado.dadosOriginais.id)} className="flex-1 bg-red-50 text-red-600 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100">
                    <Trash2 size={18} /> Excluir Grade
                  </button>
                </div>
              )}
            </div>
          </div>
        )})()}
      </Modal>

      {isAdmin && (
        <Modal isOpen={modalNovaAula.isOpen} onClose={modalNovaAula.fechar} titulo={novaAula.id ? "Editar Atividade" : "Criar Nova Grade"}>
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

              {novaAula.eh_recorrente ? (
                  <select 
                      className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 font-bold text-gray-700" 
                      required 
                      value={novaAula.modalidade_id || ''} 
                      onChange={e => {
                          const val = e.target.value;
                          if (!val) { setNovaAula({...novaAula, modalidade_id: '', atividade: '', professor_id: ''}); return; }
                          const modSelecionada = modalidades.find(m => m.id === val);
                          setNovaAula({ ...novaAula, modalidade_id: modSelecionada.id, atividade: modSelecionada.nome, professor_id: modSelecionada.professor_id || '' });
                      }}
                  >
                      <option value="">Selecione a Modalidade Base...</option>
                      {modalidades.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
              ) : (
                  <input placeholder="Nome do Evento Especial (Texto Livre)" className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700" required value={novaAula.atividade} onChange={e => setNovaAula({...novaAula, atividade: e.target.value, modalidade_id: ''})} />
              )}
              
              {novaAula.espaco === 'danca' && (
                <input type="number" placeholder="Valor base por aluno (R$) - Opcional" className="w-full p-4 bg-gray-50 rounded-2xl outline-none border-purple-100 border focus:border-purple-300" value={novaAula.valor_por_aluno} onChange={e => setNovaAula({...novaAula, valor_por_aluno: e.target.value})} />
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
      )}

      <Modal isOpen={modalLista.isOpen} onClose={modalLista.fechar} titulo="Lista de Presença / Chamada">
        {aulaParaLista && (
          <div className="space-y-4 pt-2 min-h-[300px]">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 flex flex-col gap-2">
              <h4 className="font-black text-gray-800">{aulaParaLista.atividade}</h4>
              <div className="mt-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Data da Aula</label>
                <input type="date" className="w-full p-2 bg-white rounded-lg outline-none border border-gray-200 focus:border-blue-500 font-bold text-gray-700" value={dataLista} onChange={e => setDataLista(e.target.value)} />
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
                              <button onClick={() => handleRemoverPresenca(aluno.id_relacao)} className="text-[11px] font-bold text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
                                {removendoId === aluno.id_relacao ? <RefreshCw className="animate-spin" size={14}/> : "Remover"}
                              </button>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={modalAgendamento.isOpen} onClose={modalAgendamento.fechar} titulo="Agendamento de Aula">
        <form onSubmit={handleAgendarAluno} className="space-y-4 pt-2">
          
          <div className="flex bg-gray-100 p-1 rounded-2xl mb-4">
              <button type="button" onClick={() => setAgendamentoForm({...agendamentoForm, tipo: 'cadastrado'})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'cadastrado' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}>Aluno da Casa</button>
              <button type="button" onClick={() => setAgendamentoForm({...agendamentoForm, tipo: 'visitante'})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'visitante' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`}>Aula Experimental</button>
          </div>

          <select required className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 transition-colors" value={agendamentoForm.aula_id} onChange={e => setAgendamentoForm({...agendamentoForm, aula_id: e.target.value})}>
            <option value="">Selecione a aula da grade...</option>
            {aulas.map(aula => (
              <option key={aula.id} value={aula.id}>
                {aula.atividade} - {aula.eh_recorrente ? aula.dia_semana : 'Evento Único'} às {aula.horario?.slice(0, 5)}
              </option>
            ))}
          </select>

          {agendamentoForm.tipo === 'cadastrado' ? (
            <select required className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 transition-colors animate-in fade-in" value={agendamentoForm.aluno_id} onChange={e => setAgendamentoForm({...agendamentoForm, aluno_id: e.target.value})}>
              <option value="">Selecione o aluno matriculado...</option>
              {listaAlunos.map(a => <option key={a.id} value={a.id}>{a.nome_completo}</option>)}
            </select>
          ) : (
            <input 
              required type="text" placeholder="Nome Completo do Visitante" 
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-orange-500 transition-colors animate-in fade-in" 
              value={agendamentoForm.nome_visitante} onChange={e => setAgendamentoForm({...agendamentoForm, nome_visitante: e.target.value})} 
            />
          )}

          <input type="date" required className="w-full p-4 bg-gray-50 rounded-2xl outline-none border border-transparent focus:border-blue-500 transition-colors" value={agendamentoForm.data_aula} onChange={e => setAgendamentoForm({...agendamentoForm, data_aula: e.target.value})} />
          
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
                     <div className={`flex-1 p-3 rounded-xl border font-bold text-xs flex flex-col justify-center ${
                        infoVaga.temModalidadeNoPlano === false ? 'bg-red-50 text-red-700 border-red-200' :
                        (infoVaga.usoSemanal >= infoVaga.limiteSemanal && !infoVaga.isLivre ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-blue-50 text-blue-700 border-blue-200')
                     }`}>
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

          <button disabled={savingAgendamento} className={`w-full text-white py-4 rounded-2xl font-black shadow-lg flex items-center justify-center gap-2 transition-colors ${agendamentoForm.tipo === 'cadastrado' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
            {savingAgendamento ? <RefreshCw className="animate-spin" size={20}/> : <UserCheck size={20}/>} Confirmar Vaga
          </button>
        </form>
      </Modal>

      {isAdmin && (
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
      )}
    </div>
  );
}