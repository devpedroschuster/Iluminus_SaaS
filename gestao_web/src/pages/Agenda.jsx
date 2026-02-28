import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, Clock, Plus, Star, Ban, Trash2, Edit2, Filter, 
  RefreshCw, MapPin, Dumbbell, Music
} from 'lucide-react';

// Hooks e Serviços
import { agendaService } from '../services/agendaService';
import { useAgenda } from '../hooks/useAgenda';
import { useAlunos } from '../hooks/useAlunos';

// Constantes e Utils
import { DIAS_SEMANA } from '../lib/constants';

// Componentes
import { showToast } from '../components/shared/Toast';
import { useModal } from '../components/shared/Modal';
import Modal from '../components/shared/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';

export default function Agenda() {
  // Estado Inicial do Formulário
  const initialFormState = { 
    id: null,
    atividade: '', 
    professor_id: '', 
    dia_semana: 'Segunda-feira', 
    horario: '', 
    capacidade: 15, 
    eh_recorrente: true, 
    data_especifica: '',
    espaco: 'funcional' // Novo campo padrão
  };

  const [novaAula, setNovaAula] = useState(initialFormState);
  const [novoFeriado, setNovoFeriado] = useState({ data: '', descricao: '' });

  // Filtros
  const [filtroProf, setFiltroProf] = useState('todos');
  const [filtroEspaco, setFiltroEspaco] = useState('todos'); // 'todos', 'funcional', 'danca'

  // Estados de Loading Visual
  const [savingAula, setSavingAula] = useState(false);
  const [savingFeriado, setSavingFeriado] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Hooks de Dados
  const { aulas, feriados, loading, refetch } = useAgenda();
  const { alunos: professores } = useAlunos({ role: 'professor' });

  // Modais
  const modalNovaAula = useModal();
  const modalFeriados = useModal();

  // --- ORGANIZAÇÃO DOS DADOS (GRANDE MUDANÇA AQUI) ---
  const gradeOrganizada = useMemo(() => {
    if (!aulas) return {};

    // 1. Aplica Filtros (Professor e Espaço)
    const aulasFiltradas = aulas.filter(aula => {
      const matchProf = filtroProf === 'todos' || String(aula.professor_id) === String(filtroProf);
      // Se filtroEspaco for 'todos', aceita tudo. Senão, compara com o campo espaco do banco (ou assume 'funcional' se nulo)
      const espacoAula = aula.espaco || 'funcional'; 
      const matchEspaco = filtroEspaco === 'todos' || espacoAula === filtroEspaco;
      
      return matchProf && matchEspaco;
    });

    // 2. Agrupa por dia da semana
    const grupos = {};
    
    // Inicializa colunas
    DIAS_SEMANA.forEach(dia => { grupos[dia.label] = []; });
    grupos['Eventos'] = []; 

    aulasFiltradas.forEach(aula => {
      if (aula.eh_recorrente) {
        const diaChave = aula.dia_semana || 'Outros';
        if (!grupos[diaChave]) grupos[diaChave] = []; // Proteção contra dia inválido
        grupos[diaChave].push(aula);
      } else {
        grupos['Eventos'].push(aula);
      }
    });

    // 3. Ordenação Inteligente
    Object.keys(grupos).forEach(chave => {
      if (chave === 'Eventos') {
        // CORREÇÃO #1: Ordenar Eventos por Data (Mais próximo -> Mais distante)
        grupos[chave].sort((a, b) => {
          const dataA = new Date(a.data_especifica);
          const dataB = new Date(b.data_especifica);
          if (dataA.getTime() === dataB.getTime()) {
            return a.horario.localeCompare(b.horario); // Desempate por horário
          }
          return dataA - dataB;
        });
      } else {
        // Ordenar Dias Normais por Horário
        grupos[chave].sort((a, b) => a.horario.localeCompare(b.horario));
      }
    });

    return grupos;
  }, [aulas, filtroProf, filtroEspaco]);

  // --- FUNÇÕES DE AÇÃO ---

  function handleAbrirCriar() {
    setNovaAula({ ...initialFormState, espaco: filtroEspaco === 'todos' ? 'funcional' : filtroEspaco });
    modalNovaAula.abrir();
  }

  function handleAbrirEditar(aula) {
    setNovaAula({
      id: aula.id,
      atividade: aula.atividade,
      professor_id: aula.professor_id,
      dia_semana: aula.dia_semana || 'Segunda-feira',
      horario: aula.horario, 
      capacidade: aula.capacidade,
      eh_recorrente: aula.eh_recorrente,
      data_especifica: aula.data_especifica || '',
      espaco: aula.espaco || 'funcional'
    });
    modalNovaAula.abrir();
  }

  async function salvarAula(e) {
    e.preventDefault();
    if (savingAula) return;
    setSavingAula(true);

    try {
      const payload = {
        atividade: novaAula.atividade,
        professor_id: novaAula.professor_id,
        horario: novaAula.horario,
        capacidade: Number(novaAula.capacidade),
        eh_recorrente: novaAula.eh_recorrente,
        espaco: novaAula.espaco, // Salva o espaço
        ativa: true
      };

      if (novaAula.id) payload.id = novaAula.id;

      if (novaAula.eh_recorrente) {
        payload.dia_semana = novaAula.dia_semana;
        payload.data_especifica = null; 
      } else {
        if (!novaAula.data_especifica) throw new Error("Data é obrigatória para evento único");
        payload.data_especifica = novaAula.data_especifica;
        const diaCalculado = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' })
          .format(new Date(novaAula.data_especifica + 'T00:00:00'));
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
    if (!confirm("Tem certeza que deseja excluir esta atividade?")) return;
    try {
      await agendaService.excluirAula(id);
      showToast.success("Atividade removida.");
      refetch();
    } catch (err) {
      showToast.error("Erro ao excluir.");
    }
  }

  async function cadastrarFeriado(e) {
    e.preventDefault();
    if (savingFeriado) return;
    setSavingFeriado(true);

    try {
      await agendaService.cadastrarFeriado(novoFeriado);
      showToast.success("Bloqueio adicionado!");
      setNovoFeriado({ data: '', descricao: '' });
      refetch();
    } catch (err) {
      if (err.message?.includes('unique')) {
        showToast.error("Já existe um feriado nesta data.");
      } else {
        showToast.error("Erro ao salvar feriado.");
      }
    } finally {
      setSavingFeriado(false);
    }
  }

  async function excluirFeriado(id) {
    if (!confirm("Remover este bloqueio?")) return;
    setDeletingId(id);
    try {
      await agendaService.excluirFeriado(id);
      showToast.success("Feriado removido.");
      refetch();
    } catch (err) {
      showToast.error("Erro ao excluir feriado.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      {/* Header e Ações */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Grade de Aulas</h1>
          <p className="text-gray-500">Visualize e organize a agenda semanal do estúdio.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={modalFeriados.abrir} className="bg-gray-100 text-gray-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-200 transition-colors">
            <Ban size={20} /> Bloqueios ({feriados.length})
          </button>
          <button onClick={handleAbrirCriar} className="bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:scale-[1.02] transition-all">
            <Plus size={20} /> Nova Aula
          </button>
        </div>
      </div>

      {/* CORREÇÃO #2: Barra de Controle (Abas de Espaço + Filtro Prof) */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-2 rounded-[24px] border border-gray-100 shadow-sm shrink-0">
        
        {/* Abas de Espaço */}
        <div className="flex bg-gray-100 p-1 rounded-2xl w-full md:w-auto">
          <button 
            onClick={() => setFiltroEspaco('todos')}
            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${filtroEspaco === 'todos' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Todos
          </button>
          <button 
            onClick={() => setFiltroEspaco('funcional')}
            className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'funcional' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-orange-500'}`}
          >
            <Dumbbell size={16} /> Funcional
          </button>
          <button 
            onClick={() => setFiltroEspaco('danca')}
            className={`px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${filtroEspaco === 'danca' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-400 hover:text-purple-500'}`}
          >
            <Music size={16} /> Dança
          </button>
        </div>

        {/* Filtro Professor */}
        <div className="flex items-center gap-2 pr-4 w-full md:w-auto">
          <span className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap px-2">Professor:</span>
          <select 
            className="bg-gray-50 px-4 py-2 rounded-xl font-bold text-sm outline-none cursor-pointer w-full"
            value={filtroProf}
            onChange={e => setFiltroProf(e.target.value)}
          >
            <option value="todos">Todos</option>
            {professores.map(p => (
              <option key={p.id} value={p.id}>{p.nome_completo}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid de Colunas */}
      <div className="flex-1 overflow-x-auto pb-4">
        {loading ? <TableSkeleton /> : (
          <div className="flex gap-6 min-w-max h-full">
            {/* Dias da Semana */}
            {DIAS_SEMANA.map(dia => (
              <div key={dia.valor} className="w-[280px] flex flex-col gap-3">
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between sticky top-0 z-10">
                  <h3 className="font-black text-gray-700 uppercase text-xs tracking-wider">{dia.label}</h3>
                  <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-1 rounded-lg">
                    {gradeOrganizada[dia.label]?.length || 0}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {gradeOrganizada[dia.label]?.map(aula => (
                    <CardAula 
                      key={aula.id} 
                      aula={aula} 
                      onEdit={() => handleAbrirEditar(aula)} 
                      onDelete={() => excluirAula(aula.id)} 
                    />
                  ))}
                  {(!gradeOrganizada[dia.label] || gradeOrganizada[dia.label].length === 0) && (
                    <div className="h-20 border-2 border-dashed border-gray-50 rounded-2xl flex items-center justify-center text-gray-200 text-[10px] font-bold uppercase">
                      Livre
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Coluna Eventos */}
            <div className="w-[280px] flex flex-col gap-3 border-l border-dashed border-gray-200 pl-6">
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between sticky top-0 z-10">
                <h3 className="font-black text-blue-600 uppercase text-xs tracking-wider">Eventos Específicos</h3>
                <Star size={16} className="text-blue-500" />
              </div>
              <div className="flex flex-col gap-3">
                {gradeOrganizada['Eventos']?.map(aula => (
                  <CardAula 
                    key={aula.id} 
                    aula={aula} 
                    isEvento={true}
                    onEdit={() => handleAbrirEditar(aula)} 
                    onDelete={() => excluirAula(aula.id)} 
                  />
                ))}
                {(!gradeOrganizada['Eventos'] || gradeOrganizada['Eventos'].length === 0) && (
                   <p className="text-gray-300 text-xs text-center mt-4 font-medium">Nenhum evento agendado.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- MODAIS --- */}
      
      <Modal isOpen={modalNovaAula.isOpen} onClose={modalNovaAula.fechar} titulo={novaAula.id ? "Editar Atividade" : "Agendar Atividade"}>
        <form onSubmit={salvarAula} className="space-y-4 pt-2">
            {/* Seletor de Tipo (Recorrente/Único) */}
            <div className="flex bg-gray-100 p-1 rounded-2xl mb-2">
                <button type="button" onClick={() => setNovaAula({...novaAula, eh_recorrente: true, data_especifica: ''})} 
                    className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${novaAula.eh_recorrente ? 'bg-white shadow-sm text-iluminus-terracota' : 'text-gray-400'}`}>
                    Aula Recorrente
                </button>
                <button type="button" onClick={() => setNovaAula({...novaAula, eh_recorrente: false})} 
                    className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${!novaAula.eh_recorrente ? 'bg-white shadow-sm text-iluminus-terracota' : 'text-gray-400'}`}>
                    Evento Único
                </button>
            </div>

            {/* Novo Seletor de Espaço */}
            <div className="grid grid-cols-2 gap-4">
              <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'funcional' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-gray-100 text-gray-400'}`}>
                <input type="radio" name="espaco" value="funcional" className="hidden" 
                  checked={novaAula.espaco === 'funcional'} onChange={() => setNovaAula({...novaAula, espaco: 'funcional'})} />
                <Dumbbell size={18} /> <span className="font-bold text-xs uppercase">Funcional</span>
              </label>
              <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'danca' ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-100 text-gray-400'}`}>
                <input type="radio" name="espaco" value="danca" className="hidden" 
                  checked={novaAula.espaco === 'danca'} onChange={() => setNovaAula({...novaAula, espaco: 'danca'})} />
                <Music size={18} /> <span className="font-bold text-xs uppercase">Dança</span>
              </label>
            </div>

            <input placeholder="Nome da Atividade" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required
                value={novaAula.atividade} onChange={e => setNovaAula({...novaAula, atividade: e.target.value})} />

            <div className="grid grid-cols-2 gap-4">
                {novaAula.eh_recorrente ? (
                    <select className="w-full p-4 bg-gray-50 rounded-2xl outline-none" 
                        value={novaAula.dia_semana} onChange={e => setNovaAula({...novaAula, dia_semana: e.target.value})}>
                        {DIAS_SEMANA.map(d => <option key={d.valor} value={d.label}>{d.label}</option>)}
                    </select>
                ) : (
                    <input type="date" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required
                        value={novaAula.data_especifica} onChange={e => setNovaAula({...novaAula, data_especifica: e.target.value})} />
                )}
                <input type="time" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required
                    value={novaAula.horario} onChange={e => setNovaAula({...novaAula, horario: e.target.value})} />
            </div>

            <select className="w-full p-4 bg-gray-50 rounded-2xl outline-none" required
                value={novaAula.professor_id} onChange={e => setNovaAula({...novaAula, professor_id: e.target.value})}>
                <option value="">Selecione o Professor</option>
                {professores.map(p => <option key={p.id} value={p.id}>{p.nome_completo}</option>)}
            </select>

            <button 
              disabled={savingAula}
              className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black shadow-lg hover:scale-[1.01] transition-all flex items-center justify-center gap-2"
            >
                {savingAula ? <RefreshCw className="animate-spin" size={20}/> : null}
                {savingAula ? "Salvando..." : (novaAula.id ? "Salvar Alterações" : "Salvar na Grade")}
            </button>
        </form>
      </Modal>

      {/* Modal Feriados (Mantido igual) */}
      <Modal isOpen={modalFeriados.isOpen} onClose={modalFeriados.fechar} titulo="Gerenciar Bloqueios">
        <div className="space-y-6 pt-2">
            <form onSubmit={cadastrarFeriado} className="flex gap-2">
                <input type="date" className="p-3 bg-gray-50 rounded-xl outline-none border border-gray-100" required
                    value={novoFeriado.data} onChange={e => setNovoFeriado({...novoFeriado, data: e.target.value})} />
                <input type="text" placeholder="Motivo (ex: Feriado)" className="flex-1 p-3 bg-gray-50 rounded-xl outline-none border border-gray-100" required
                    value={novoFeriado.descricao} onChange={e => setNovoFeriado({...novoFeriado, descricao: e.target.value})} />
                
                <button disabled={savingFeriado} className="bg-gray-800 text-white p-3 rounded-xl font-bold flex items-center justify-center min-w-[50px]">
                  {savingFeriado ? <RefreshCw className="animate-spin" size={18}/> : <Plus />}
                </button>
            </form>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                {feriados.length === 0 ? <p className="text-sm text-gray-400 italic">Nenhum bloqueio cadastrado.</p> : feriados.map(f => (
                    <div key={f.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <div>
                            <p className="font-bold text-gray-700 text-sm">{f.descricao}</p>
                            <p className="text-xs text-gray-400 font-medium">{new Date(f.data).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        </div>
                        <button onClick={() => excluirFeriado(f.id)} disabled={deletingId === f.id} className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-lg">
                           {deletingId === f.id ? <RefreshCw className="animate-spin" size={16}/> : <Trash2 size={16}/>}
                        </button>
                    </div>
                ))}
            </div>
        </div>
      </Modal>
    </div>
  );
}

// Subcomponente de Card (Atualizado com Badge de Espaço)
function CardAula({ aula, onEdit, onDelete, isEvento = false }) {
  const isFuncional = (aula.espaco || 'funcional') === 'funcional';

  return (
    <div className={`p-4 rounded-[24px] border relative group hover:shadow-md transition-all cursor-pointer bg-white ${isEvento ? 'border-blue-100' : 'border-gray-100'}`}>
      
      {/* Badge de Horário + Ícone do Espaço */}
      <div className="flex justify-between items-start mb-2">
        <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${isEvento ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
          {aula.horario.slice(0, 5)}
        </span>
        
        {/* Indicador Visual do Espaço */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isFuncional ? 'bg-orange-50 text-orange-500' : 'bg-purple-50 text-purple-500'}`} title={isFuncional ? "Funcional" : "Dança"}>
           {isFuncional ? <Dumbbell size={12} /> : <Music size={12} />}
        </div>
      </div>

      {isEvento && (
        <span className="text-[9px] font-black text-blue-400 uppercase block mb-1">
          {new Date(aula.data_especifica).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
        </span>
      )}

      {/* Conteúdo */}
      <h4 className="font-bold text-gray-800 leading-tight text-sm mb-1">{aula.atividade}</h4>
      <p className="text-[10px] text-gray-400 font-medium truncate flex items-center gap-1">
        Prof. {aula.alunos?.nome_completo?.split(' ')[0]}
      </p>

      {/* Ações */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 p-1 rounded-lg shadow-sm">
        <button onClick={e => { e.stopPropagation(); onEdit(); }} className="p-1.5 hover:bg-orange-50 text-gray-400 hover:text-iluminus-terracota rounded-md">
          <Edit2 size={12} />
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-md">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}