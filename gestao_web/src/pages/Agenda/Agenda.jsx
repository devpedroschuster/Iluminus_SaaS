import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Ban, UserCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';

import { gradeService } from '../../services/gradeService';
import { alunosService } from '../../services/alunosService';
import { useAgenda } from '../../hooks/useAgenda';
import Modal, { useModal, ModalConfirmacao } from '../../components/ui/Modal';
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
import EmptyState from '../../components/ui/EmptyState';
import { Dumbbell, Music, CalendarX } from 'lucide-react';
import { useMemo } from 'react';

const INITIAL_FORM_STATE = {
  id: null,
  atividade: '',
  modalidadeId: '',
  professorId: '',
  diaSemana: 'segunda-feira',
  horario: '',
  capacidade: 15,
  ehRecorrente: true,
  dataEspecifica: '',
  espaco: 'funcional',
  valorPorAluno: '',
  cor: 'laranja',
  duracaoMinutos: 60, // padrão 1h
};

export default function Agenda() {
  const { perfil, professorId: professorIdLogado } = useOutletContext();
  const isAdmin = perfil === 'admin';

  const [novaAula, setNovaAula] = useState(INITIAL_FORM_STATE);
  const [eventoSelecionado, setEventoSelecionado] = useState(null);
  const [aulaParaLista, setAulaParaLista] = useState(null);
  const [dataLista, setDataLista] = useState(new Date().toISOString().split('T')[0]);

  const { aulas, feriados, loading, isError, refetch } = useAgenda();

  const { data: listaAlunos = [] } = useQuery({
    queryKey: ['alunos', 'ativos-agendamento'],
    queryFn: () => alunosService.listarAtivos(),
    staleTime: 1000 * 60 * 5,
  });

  // A1: professor não precisa da lista de professores, modalidades nem matrículas fixas
  const { data: professores = [] } = useQuery({
    queryKey: ['professores'],
    queryFn: () => gradeService.listarProfessores(),
    staleTime: 1000 * 60 * 5,
    enabled: isAdmin,
  });

  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades'],
    queryFn: () => gradeService.listarModalidades(),
    staleTime: 1000 * 60 * 5,
    enabled: isAdmin,
  });

  const { data: matriculasFixas = [] } = useQuery({
  queryKey: ['matriculas-fixas', isAdmin ? 'admin' : professorIdLogado],
  queryFn: () => {
    if (isAdmin) return gradeService.listarMatriculasFixas();
    // Para professor: filtra só pelas aulas que ele leciona
    const idsAulas = (aulas || []).map(a => a.id);
    if (idsAulas.length === 0) return [];
    return gradeService.listarMatriculasFixas(idsAulas);
  },
  staleTime: 1000 * 60 * 5,
  enabled: isAdmin ? true : (aulas || []).length > 0, // ← aguarda aulas carregarem
});

  const dadosIniciais = { professores, modalidades, matriculasFixas };

  const pageState = useAgendaPage();

const espacosDisponiveis = useMemo(() => {
  if (isAdmin || !aulas?.length) return undefined;
  const set = new Set(aulas.map(a => a.espaco || 'funcional'));
  return set;
}, [isAdmin, aulas]);

const emptyStateEspaco = useMemo(() => {
  if (pageState.filtroEspaco === 'todos') return null;

  const labels = { funcional: 'Funcional', danca: 'Dança' };
  const icons  = { funcional: <Dumbbell size={28} />, danca: <Music size={28} /> };
  const label  = labels[pageState.filtroEspaco] ?? pageState.filtroEspaco;

  return {
    icon:        icons[pageState.filtroEspaco] ?? <CalendarX size={28} />,
    title:       `Sem aulas de ${label}`,
    description: isAdmin
      ? `Nenhuma aula de ${label} cadastrada para este período.`
      : `Você não tem aulas de ${label} cadastradas neste período.`,
  };
}, [pageState.filtroEspaco, isAdmin]);

  const dadosMes = useAgendaDadosMes(pageState.currentDate);

  const modais = {
    novaAula: useModal(), agendamento: useModal(), lista: useModal(),
    acoesEvento: useModal(), feriados: useModal(), excluir: useModal(), encerrar: useModal(),
  };

  const hookAgendamento = useAgendamento(() => modais.agendamento.fechar(), feriados);
  const hookLista = useListaPresenca(aulaParaLista, dataLista, modais.lista.isOpen);
  const hookFeriados = useFeriados(refetch);
  const eventosCalendario = useEventosCalendario({ aulas, feriados, ...dadosMes, matriculasFixas: dadosIniciais.matriculasFixas, ...pageState });

  const mutations = useGradeMutations({
    onSuccess: () => {
      Object.values(modais).forEach((m) => m.isOpen && m.fechar());
      refetch();
    },
  });

  const handleSelectSlot = ({ start }) => {
    if (!isAdmin) return;
    const dataStr = format(start, 'yyyy-MM-dd');
    const ehFeriado = feriados.find((f) => f.data === dataStr && f.bloqueia_agenda);
    if (ehFeriado) return showToast.error(`Data bloqueada: ${ehFeriado.descricao}`);

    const dia = format(start, 'eeee', { locale: ptBR }).toLowerCase();
    setNovaAula({
      ...INITIAL_FORM_STATE,
      horario: format(start, 'HH:mm'),
      diaSemana: dia,
      dataEspecifica: dataStr,
    });
    modais.novaAula.abrir();
  };

  const btnBase = 'px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-colors disabled:opacity-50';
  const btnSecondary = `${btnBase} bg-muted text-muted-foreground hover:bg-subtle`;
  const btnInfo = `${btnBase} bg-info text-info-foreground hover:bg-info/90`;
  const btnPrimary = `${btnBase} bg-primary text-primary-foreground hover:bg-primary/90`;

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500 min-h-screen flex flex-col bg-background">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">Grade de Aulas</h1>
          <p className="text-muted-foreground font-medium">Visualize e organize a agenda do estúdio.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {isAdmin && (
            <button onClick={modais.feriados.abrir} className={btnSecondary}>
              <Ban size={20} /> Bloqueios ({feriados.length})
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                hookAgendamento.setAgendamentoForm({ ...hookAgendamento.agendamentoForm, aula_id: '', data_aula: '' });
                modais.agendamento.abrir();
              }}
              className={btnInfo}
            >
              <UserCheck size={20} /> Agendar na Turma
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                setNovaAula(INITIAL_FORM_STATE);
                modais.novaAula.abrir();
              }}
              className={btnPrimary}
            >
              <Plus size={20} /> Nova Aula
            </button>
          )}
        </div>
      </div>

      <FiltrosAgenda 
  {...pageState} 
  professores={dadosIniciais.professores} 
  isAdmin={isAdmin}
  espacosDisponiveis={espacosDisponiveis}
/>

      <div className="bg-card p-6 rounded-[32px] border border-border shadow-sm" style={{ height: '750px' }}>
  {isError ? (
    <div className="h-full flex items-center justify-center">
      <EmptyState
        icon={<CalendarX size={28} />}
        title="Erro ao carregar agenda"
        description="Não foi possível buscar as aulas. Verifique sua conexão e tente novamente."
        action={
          <button
            onClick={refetch}
            className="text-sm font-bold text-primary hover:underline"
          >
            Tentar novamente
          </button>
        }
      />
    </div>
  ) : loading ? (
    <TableSkeleton />
  ) : eventosCalendario.filter(e => !e.isFeriado).length === 0 && emptyStateEspaco ? (
    // Filtro de espaço ativo mas sem eventos — EmptyState contextual
    <div className="h-full flex items-center justify-center">
      <EmptyState
        icon={emptyStateEspaco.icon}
        title={emptyStateEspaco.title}
        description={emptyStateEspaco.description}
        action={
          <button
            onClick={() => pageState.setFiltroEspaco('todos')}
            className="text-sm font-bold text-primary hover:underline"
          >
            Ver todos os espaços
          </button>
        }
      />
    </div>
  ) : (
    <CalendarioGrade
      eventos={eventosCalendario}
      currentDate={pageState.currentDate}
      setCurrentDate={pageState.setCurrentDate}
      currentView={pageState.currentView}
      setCurrentView={pageState.setCurrentView}
      handleSelectSlot={handleSelectSlot}
      isAdmin={isAdmin}
      handleSelectEvent={(ev) => {
        ev.isFeriado
          ? showToast.error(`Dia bloqueado: ${ev.dadosOriginais.descricao}`)
          : (setEventoSelecionado(ev), modais.acoesEvento.abrir());
      }}
    />
  )}
</div>

      <Modal isOpen={modais.agendamento.isOpen} onClose={modais.agendamento.fechar} titulo="Agendamento">
        <ModalAgendamento {...hookAgendamento} aulas={aulas} listaAlunos={listaAlunos} />
      </Modal>
      <Modal isOpen={modais.novaAula.isOpen} onClose={modais.novaAula.fechar} titulo={novaAula.id ? 'Editar Atividade' : 'Nova Aula'}>
        <ModalNovaAula
          novaAula={novaAula}
          setNovaAula={setNovaAula}
          modalidades={dadosIniciais.modalidades}
          professores={dadosIniciais.professores}
          savingAula={mutations.savingAula}
          salvarAula={(e) => {
            e.preventDefault();
            mutations.salvarAula(novaAula);
          }}
        />
      </Modal>
      <Modal isOpen={modais.lista.isOpen} onClose={modais.lista.fechar} titulo="Chamada">
        <ModalListaPresenca {...hookLista} aulaParaLista={aulaParaLista} dataLista={dataLista} setDataLista={setDataLista} isAdmin={isAdmin} />
      </Modal>
      {isAdmin && (
        <Modal isOpen={modais.feriados.isOpen} onClose={modais.feriados.fechar} titulo="Gerenciar Bloqueios (Feriados)">
          <ModalFeriados feriados={feriados} {...hookFeriados} />
        </Modal>
      )}

      <Modal isOpen={modais.acoesEvento.isOpen} onClose={modais.acoesEvento.fechar} titulo="Detalhes da Aula">
        <ModalAcoesEvento
          evento={eventoSelecionado}
          isAdmin={isAdmin}
          professorIdLogado={professorIdLogado}
          onAgendar={(ev) => {
            modais.acoesEvento.fechar();
            hookAgendamento.setAgendamentoForm({
              tipo: 'cadastrado',
              aluno_id: '',
              nome_visitante: '',
              aula_id: ev.dadosOriginais.id,
              data_aula: format(ev.start, 'yyyy-MM-dd'),
            });
            modais.agendamento.abrir();
          }}
          onChamada={(ev) => {
            modais.acoesEvento.fechar();
            setAulaParaLista(ev.dadosOriginais);
            setDataLista(format(ev.start, 'yyyy-MM-dd'));
            modais.lista.abrir();
          }}
          onEditar={(ev) => {
            modais.acoesEvento.fechar();
            const d = ev.dadosOriginais;
            setNovaAula({
              id: d.id,
              atividade: d.atividade,
              modalidadeId: d.modalidade_id || '',
              professorId: d.professor_id || '',
              diaSemana: String(d.dia_semana || 'segunda-feira').toLowerCase(),
              horario: d.horario,
              capacidade: d.capacidade,
              ehRecorrente: d.eh_recorrente,
              dataEspecifica: d.data_especifica || '',
              espaco: d.espaco,
              valorPorAluno: d.valor_por_aluno || '',
              cor: d.cor,
              duracaoMinutos: d.duracao_minutos ?? 60, // carrega duração salva ao editar
            });
            modais.novaAula.abrir();
          }}
          onEncerrar={() => modais.encerrar.abrir()}
          onExcluir={() => modais.excluir.abrir()}
        />
      </Modal>

      <ModalConfirmacao
        isOpen={modais.excluir.isOpen}
        onClose={modais.excluir.fechar}
        onConfirm={() => mutations.excluirAula(eventoSelecionado.dadosOriginais.id)}
        titulo="Excluir Grade Permanentemente"
        mensagem="Atenção: Ao confirmar, todas as aulas e presenças desta grade serão apagadas. Esta ação NÃO pode ser desfeita."
        tipo="danger"
      />
      <ModalConfirmacao
        isOpen={modais.encerrar.isOpen}
        onClose={modais.encerrar.fechar}
        onConfirm={() => mutations.encerrarAula(eventoSelecionado.dadosOriginais.id, eventoSelecionado.start)}
        titulo="Encerrar Turma"
        mensagem={`O histórico será mantido, mas esta turma não aparecerá mais a partir de ${
          eventoSelecionado ? format(eventoSelecionado.start, 'dd/MM/yyyy') : ''
        }. Confirma?`}
        tipo="warning"
      />
    </div>
  );
}