import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, CheckCircle, XCircle, Clock, RefreshCw, MessageCircle, LayoutGrid, List, X, ChevronDown, TrendingUp, TrendingDown, Minus, Calendar, MessageSquare } from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import {
  useLeadsPendentes,
  useLeadsPendentesPorMes,
  useHistoricoLeads,
  useHistoricoLeadsPorMes,
  useResumoMensalLeads,
  useResumoMensalLeadsPendentes,
  useAtualizarStatusLead,
  useAtualizarObservacaoLead,
} from '../hooks/useLeads';
import Badge   from '../components/ui/Badge';
import Button  from '../components/ui/Button';
import Surface from '../components/ui/Surface';
import EmptyState from '../components/ui/EmptyState';

// Média histórica de referência para comparação (pode ser ajustada conforme o negócio)
const MEDIA_HISTORICA = 0.55;

// Valor especial usado no seletor de período para representar "todos os meses"
const TODOS_PERIODOS = 'todos';

// ── Dropdown de Status Inline ───────────────────────────────────────────────
function StatusDropdown({ lead, onAlterarStatus, isProcessando }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickFora(e) {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    }
    if (aberto) document.addEventListener('mousedown', handleClickFora);
    return () => document.removeEventListener('mousedown', handleClickFora);
  }, [aberto]);

  const opcoes = [
    { status: 'convertido', label: 'Convertido', tone: 'success', icon: <CheckCircle size={13} /> },
    { status: 'pendente',   label: 'Pendente',   tone: 'warning', icon: <Clock size={13} /> },
    { status: 'perdido',    label: 'Perdido',    tone: 'destructive', icon: <XCircle size={13} /> },
  ];

  const atual = opcoes.find(o => o.status === lead.status_conversao) ?? opcoes[1];

  if (isProcessando) {
    return (
      <Badge tone={atual.tone} variant="soft">
        <RefreshCw size={12} className="animate-spin" /> {atual.label}
      </Badge>
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setAberto(v => !v)}
        title="Alterar status"
        className="flex items-center gap-1 focus:outline-none group"
      >
        <Badge tone={atual.tone} variant="soft" className="cursor-pointer group-hover:opacity-80 transition-opacity">
          {atual.icon} {atual.label}
          <ChevronDown size={11} className={`ml-0.5 transition-transform ${aberto ? 'rotate-180' : ''}`} />
        </Badge>
      </button>

      {aberto && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-card overflow-hidden min-w-[140px] animate-in fade-in zoom-in-95">
          {opcoes.map(({ status, label, tone, icon }) => (
            <button
              key={status}
              disabled={status === lead.status_conversao}
              onClick={() => {
                setAberto(false);
                onAlterarStatus(lead.id, status);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left transition-colors
                ${status === lead.status_conversao
                  ? 'opacity-40 cursor-default bg-muted'
                  : 'hover:bg-muted cursor-pointer'
                }`}
            >
              <Badge tone={tone} variant="soft" className="pointer-events-none">
                {icon} {label}
              </Badge>
              {status === lead.status_conversao && (
                <span className="ml-auto text-[10px] font-black text-muted-foreground uppercase tracking-wide">atual</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
// ───────────────────────────────────────────────────────────────────────────

// ── Seletor de Período (mês/ano) ────────────────────────────────────────────
function SeletorPeriodo({ resumoMensal, periodoSelecionado, onSelecionarPeriodo, labelTotal = 'experimentais' }) {
  return (
    <div className="relative">
      <select
        value={periodoSelecionado}
        onChange={(e) => onSelecionarPeriodo(e.target.value)}
        className="appearance-none bg-card border border-border rounded-xl pl-10 pr-9 py-2.5 text-sm font-bold text-foreground cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <option value={TODOS_PERIODOS}>Todos os períodos</option>
        {resumoMensal.map(item => (
          <option key={item.chave} value={item.chave}>
            {item.label} · {item.total} {item.total === 1 ? labelTotal.replace(/s$/, '') : labelTotal}
          </option>
        ))}
      </select>
      <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
    </div>
  );
}
// ───────────────────────────────────────────────────────────────────────────

// ── Campo de Observação (textarea com auto-save no blur) ────────────────────
function ObservacaoLead({ lead, onSalvar, isSalvando }) {
  const [valor, setValor] = useState(lead.observacao || '');
  const [expandido, setExpandido] = useState(!!lead.observacao);

  useEffect(() => {
    setValor(lead.observacao || '');
  }, [lead.observacao]);

  function handleBlur() {
    const valorTratado = valor.trim();
    if (valorTratado !== (lead.observacao || '')) {
      onSalvar(lead.id, valorTratado);
    }
  }

  if (!expandido) {
    return (
      <button
        onClick={() => setExpandido(true)}
        className="mt-2 w-full flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground hover:text-primary transition-colors py-1.5 rounded-lg hover:bg-primary/5 border border-dashed border-border"
      >
        <MessageSquare size={13} /> Adicionar observação
      </button>
    );
  }

  return (
    <div className="mt-2 relative">
      <textarea
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={handleBlur}
        placeholder="Ex: não fechou por preço, aguardando dinheiro..."
        rows={2}
        className="w-full text-xs font-medium text-foreground bg-muted border border-border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground placeholder:italic"
      />
      {isSalvando && (
        <RefreshCw size={12} className="animate-spin text-muted-foreground absolute top-2 right-2" />
      )}
    </div>
  );
}
// ───────────────────────────────────────────────────────────────────────────

export default function Leads() {
  const navigate = useNavigate();
  const [visaoAtiva, setVisaoAtiva] = useState('cards');
  const [confirmandoId, setConfirmandoId] = useState(null);

  // ── Período selecionado em cada visão (independentes) ────────────────────
  // 'todos' ou uma chave 'AAAA-MM'
  const [periodoAcao, setPeriodoAcao] = useState(TODOS_PERIODOS);
  const [periodoHistorico, setPeriodoHistorico] = useState(TODOS_PERIODOS);

  // ── Visão Ação (cards pendentes) ──────────────────────────────────────────
  const { data: leadsPendentesTodos = [], isLoading: loadingPendentesTodos } = useLeadsPendentes();
  const { data: resumoMensalPendentes = [], isLoading: loadingResumoPendentes } = useResumoMensalLeadsPendentes();

  const usandoFiltroAcao = periodoAcao !== TODOS_PERIODOS;
  const [anoAcao, mesAcao] = usandoFiltroAcao ? periodoAcao.split('-').map(Number) : [0, 0];

  const {
    data: leadsPendentesMes = [],
    isLoading: loadingPendentesMes,
  } = useLeadsPendentesPorMes(anoAcao, mesAcao);

  const leadsPendentes = usandoFiltroAcao ? leadsPendentesMes : leadsPendentesTodos;
  const loadingPendentes = usandoFiltroAcao ? loadingPendentesMes : loadingPendentesTodos;

  // ── Visão Histórico ────────────────────────────────────────────────────────
  const { data: resumoMensal = [], isLoading: loadingResumo } = useResumoMensalLeads();

  const {
    data: historicoData,
    isLoading: loadingHistoricoCompleto,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useHistoricoLeads();

  const usandoFiltroHistorico = periodoHistorico !== TODOS_PERIODOS;
  const [anoHistorico, mesHistorico] = usandoFiltroHistorico ? periodoHistorico.split('-').map(Number) : [0, 0];

  const {
    data: historicoMes = [],
    isLoading: loadingHistoricoMes,
  } = useHistoricoLeadsPorMes(anoHistorico, mesHistorico);

  const mutationStatus = useAtualizarStatusLead();
  const mutationObservacao = useAtualizarObservacaoLead();

  const leadsHistoricoCompleto = historicoData?.pages.flatMap(page => page) || [];
  const leadsHistorico = usandoFiltroHistorico ? historicoMes : leadsHistoricoCompleto;
  const loadingHistorico = usandoFiltroHistorico ? loadingHistoricoMes : loadingHistoricoCompleto;

  // ── Métricas do período selecionado (Visão Histórico) ───────────────────
  const metricas = useMemo(() => {
    if (usandoFiltroHistorico) {
      const resumoDoMes = resumoMensal.find(r => r.chave === periodoHistorico);
      if (resumoDoMes) {
        return { total: resumoDoMes.total, convertidos: resumoDoMes.convertidos, taxa: resumoDoMes.taxa };
      }
      const total = leadsHistorico.length;
      const convertidos = leadsHistorico.filter(l => l.status_conversao === 'convertido').length;
      return { total, convertidos, taxa: total > 0 ? convertidos / total : null };
    }

    // Modo "Todos os períodos": agrega tudo a partir do resumo mensal
    const total = resumoMensal.reduce((acc, r) => acc + r.total, 0);
    const convertidos = resumoMensal.reduce((acc, r) => acc + r.convertidos, 0);
    const taxa = total > 0 ? convertidos / total : null;
    return { total, convertidos, taxa };
  }, [usandoFiltroHistorico, periodoHistorico, resumoMensal, leadsHistorico]);

  const comparacaoMedia =
    metricas.taxa === null
      ? null
      : metricas.taxa > MEDIA_HISTORICA
      ? 'acima'
      : metricas.taxa < MEDIA_HISTORICA
      ? 'abaixo'
      : 'igual';

  // ── Label descritivo do período exibido no banner ────────────────────────
  const labelPeriodoHistorico = useMemo(() => {
    if (!usandoFiltroHistorico) return 'Em todos os períodos';
    const resumoDoMes = resumoMensal.find(r => r.chave === periodoHistorico);
    return resumoDoMes ? `Em ${resumoDoMes.label}` : 'No período selecionado';
  }, [usandoFiltroHistorico, periodoHistorico, resumoMensal]);

  // ──────────────────────────────────────────────────────────────────────────

  function alterarStatus(leadId, novoStatus) {
    const mensagens = {
      convertido: 'Lead marcado como convertido.',
      perdido:    'Visitante marcado como perdido.',
      pendente:   'Lead reaberto como pendente.',
    };
    mutationStatus.mutate({ id: leadId, status: novoStatus }, {
      onSuccess: () => showToast.success(mensagens[novoStatus] ?? 'Status atualizado.'),
    });
  }

  function salvarObservacao(leadId, observacao) {
    mutationObservacao.mutate({ id: leadId, observacao });
  }

  function marcarComoPerdido(leadId) {
    setConfirmandoId(null);
    alterarStatus(leadId, 'perdido');
  }

  function formatarData(dataIso) {
    if (!dataIso) return '';
    const dataSegura = typeof dataIso === 'string' && dataIso.length === 10
      ? dataIso + 'T12:00:00'
      : dataIso;
    return new Date(dataSegura).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatarDataHora(dataIso) {
    if (!dataIso) return '';
    return new Date(dataIso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function contatarWhatsApp(lead) {
    if (!lead.telefone) {
      showToast.error("Este visitante não deixou o número de WhatsApp.");
      return;
    }
    const numeroLimpo = lead.telefone.replace(/\D/g, '');
    const mensagem = encodeURIComponent(
      `Olá ${lead.nome}, tudo bem? Aqui é do Espaço Iluminus! O que achou da sua aula experimental de ${lead.agenda?.atividade}?`
    );
    window.open(`https://wa.me/55${numeroLimpo}?text=${mensagem}`, '_blank');
  }

  function iniciarMatricula(lead) {
    navigate('/alunos/novo', { state: { leadParaConversao: lead } });
  }

  const isProcessando = (id) => mutationStatus.isPending && mutationStatus.variables?.id === id;
  const isSalvandoObservacao = (id) => mutationObservacao.isPending && mutationObservacao.variables?.id === id;
  const loading = visaoAtiva === 'cards' ? loadingPendentes : loadingHistorico;

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
      {/* Cabeçalho e Alternador de Visão */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <Clock className="text-primary" size={32} />
            CRM de Experimentais
          </h1>
          <p className="text-muted-foreground mt-2">Converta visitantes em alunos e acompanhe o histórico.</p>
        </div>
        <div className="flex bg-muted p-1 rounded-2xl border border-border">
          <button
            onClick={() => setVisaoAtiva('cards')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black uppercase transition-all ${
              visaoAtiva === 'cards'
                ? 'bg-card text-primary shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid size={18} /> Ação ({leadsPendentesTodos.length})
          </button>
          <button
            onClick={() => setVisaoAtiva('lista')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black uppercase transition-all ${
              visaoAtiva === 'lista'
                ? 'bg-card text-info shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List size={18} /> Histórico Completo
          </button>
        </div>
      </div>

      {/* ── Banner de Taxa de Conversão (apenas na Visão Histórico) ──── */}
      {visaoAtiva === 'lista' && !loadingResumo && metricas.taxa !== null && (
        <div
          className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${
            comparacaoMedia === 'acima'
              ? 'bg-success/10 border-success/30'
              : comparacaoMedia === 'abaixo'
              ? 'bg-warning/10 border-warning/30'
              : 'bg-muted border-border'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">📊</span>
            <span className="text-sm font-bold text-foreground">
              {labelPeriodoHistorico}:{' '}
              <span className="font-black">{metricas.total} experimentais</span>
              {' → '}
              <span className="font-black">{metricas.convertidos} convertidos</span>
              {'  '}
              <span
                className={`text-base font-black ${
                  comparacaoMedia === 'acima'
                    ? 'text-success'
                    : comparacaoMedia === 'abaixo'
                    ? 'text-warning'
                    : 'text-muted-foreground'
                }`}
              >
                ({Math.round(metricas.taxa * 100)}% conversão)
              </span>
            </span>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-black uppercase tracking-wide ${
              comparacaoMedia === 'acima'
                ? 'bg-success/20 text-success'
                : comparacaoMedia === 'abaixo'
                ? 'bg-warning/20 text-warning'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {comparacaoMedia === 'acima' && <TrendingUp size={13} />}
            {comparacaoMedia === 'abaixo' && <TrendingDown size={13} />}
            {comparacaoMedia === 'igual' && <Minus size={13} />}
            {comparacaoMedia === 'acima'
              ? 'Melhor que a média'
              : comparacaoMedia === 'abaixo'
              ? 'Abaixo da média'
              : 'Na média'}
          </span>
        </div>
      )}
      {/* ────────────────────────────────────────────────────────────── */}

      {/* Conteúdo Principal */}
      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="animate-spin text-primary" size={40} />
        </div>
      ) : visaoAtiva === 'cards' ? (
        /* Visão Cards (Ação) */
        <div className="space-y-4">
          {/* Filtro de período */}
          {(resumoMensalPendentes.length > 0 || usandoFiltroAcao) && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm font-bold text-muted-foreground">
                {usandoFiltroAcao
                  ? `Exibindo ${leadsPendentes.length} ${leadsPendentes.length === 1 ? 'lead pendente' : 'leads pendentes'} do período selecionado.`
                  : `Exibindo todos os ${leadsPendentesTodos.length} leads pendentes.`}
              </p>
              <SeletorPeriodo
                resumoMensal={resumoMensalPendentes}
                periodoSelecionado={periodoAcao}
                onSelecionarPeriodo={setPeriodoAcao}
                labelTotal="pendentes"
              />
            </div>
          )}

          {/* Cards de resumo por mês */}
          {resumoMensalPendentes.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {resumoMensalPendentes.map(item => (
                <button
                  key={item.chave}
                  onClick={() => setPeriodoAcao(prev => prev === item.chave ? TODOS_PERIODOS : item.chave)}
                  className={`flex-shrink-0 text-left rounded-2xl border px-4 py-3 min-w-[150px] transition-all ${
                    periodoAcao === item.chave
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{item.label}</p>
                  <p className="text-lg font-black text-foreground mt-1">
                    {item.total} <span className="text-xs font-bold text-muted-foreground">{item.total === 1 ? 'pendente' : 'pendentes'}</span>
                  </p>
                </button>
              ))}
            </div>
          )}

          {leadsPendentes.length === 0 ? (
            <EmptyState
              icon={<CheckCircle size={28} />}
              title={usandoFiltroAcao ? "Sem pendências neste período" : "Caixa de Entrada Zerada!"}
              description={usandoFiltroAcao
                ? "Não há leads pendentes para o mês selecionado."
                : "Todos os leads já foram contatados ou convertidos."}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {leadsPendentes.map(lead => (
                <Surface key={lead.id} variant="card" padding="lg" className="flex flex-col relative group hover:shadow-brand transition-all">
                  {/* Popover de Confirmação / Descartar */}
                  {confirmandoId === lead.id ? (
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-card p-1 rounded-xl shadow-card border border-destructive/20 animate-in fade-in zoom-in-95 z-10">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => marcarComoPerdido(lead.id)}
                      >
                        Marcar como perdido
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmandoId(null)}
                        title="Cancelar"
                      >
                        <X size={16} />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmandoId(lead.id)}
                      disabled={isProcessando(lead.id)}
                      title="Descartar visitante"
                      className="absolute top-4 right-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      {isProcessando(lead.id)
                        ? <RefreshCw size={18} className="animate-spin text-destructive" />
                        : <XCircle size={18} />
                      }
                    </Button>
                  )}
                  {/* Dados Lead */}
                  <div className="mb-4">
                    <Badge tone="brand" variant="soft" className="mb-3 rounded-lg">
                      {lead.agenda?.atividade}
                    </Badge>
                    <h3 className="font-black text-foreground text-xl leading-tight">{lead.nome}</h3>
                    <p className="text-xs font-bold text-muted-foreground mt-1">Realizou em: {formatarData(lead.data_checkin)}</p>
                  </div>
                  <Surface variant="muted" padding="sm" className="mb-6 flex items-center gap-3 rounded-xl border border-border">
                    <MessageCircle size={18} className={lead.telefone ? "text-success" : "text-muted-foreground"} />
                    <span className={`text-sm font-bold ${lead.telefone ? "text-foreground" : "text-muted-foreground italic"}`}>
                      {lead.telefone || "Sem telefone cadastrado"}
                    </span>
                  </Surface>
                  {/* Ações do Card */}
                  <div className="flex gap-2 mt-auto">
                    <Button
                      variant="success"
                      size="md"
                      fullWidth
                      leftIcon={<Phone size={18} />}
                      onClick={() => contatarWhatsApp(lead)}
                      disabled={!lead.telefone}
                    >
                      Contatar
                    </Button>
                    <Button
                      variant="info"
                      size="md"
                      fullWidth
                      leftIcon={<CheckCircle size={18} />}
                      onClick={() => iniciarMatricula(lead)}
                    >
                      Matricular
                    </Button>
                  </div>
                  {/* ── Ação rápida: marcar convertido sem matricular ── */}
                  <button
                    onClick={() => alterarStatus(lead.id, 'convertido')}
                    disabled={isProcessando(lead.id)}
                    className="mt-3 w-full text-xs font-bold text-muted-foreground hover:text-success transition-colors text-center py-1 rounded-lg hover:bg-success/5 disabled:opacity-40"
                  >
                    Já matriculado? Marcar como convertido
                  </button>
                  {/* ── Observação livre da administração ── */}
                  <ObservacaoLead
                    lead={lead}
                    onSalvar={salvarObservacao}
                    isSalvando={isSalvandoObservacao(lead.id)}
                  />
                </Surface>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Visão Histórico */
        <div className="space-y-4">
          {/* Filtro de período */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm font-bold text-muted-foreground">
              {usandoFiltroHistorico
                ? `Exibindo ${leadsHistorico.length} ${leadsHistorico.length === 1 ? 'registro' : 'registros'} do período selecionado.`
                : 'Exibindo todos os registros (carregamento incremental).'}
            </p>
            <SeletorPeriodo
              resumoMensal={resumoMensal}
              periodoSelecionado={periodoHistorico}
              onSelecionarPeriodo={setPeriodoHistorico}
            />
          </div>

          {/* Cards de resumo por mês */}
          {resumoMensal.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {resumoMensal.map(item => (
                <button
                  key={item.chave}
                  onClick={() => setPeriodoHistorico(prev => prev === item.chave ? TODOS_PERIODOS : item.chave)}
                  className={`flex-shrink-0 text-left rounded-2xl border px-4 py-3 min-w-[160px] transition-all ${
                    periodoHistorico === item.chave
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{item.label}</p>
                  <p className="text-lg font-black text-foreground mt-1">
                    {item.total} <span className="text-xs font-bold text-muted-foreground">experimentais</span>
                  </p>
                  <p className="text-xs font-bold text-success mt-0.5">
                    {item.convertidos} convertidos
                    {item.taxa !== null && ` · ${Math.round(item.taxa * 100)}%`}
                  </p>
                </button>
              ))}
            </div>
          )}

          <Surface variant="card" padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-muted text-muted-foreground text-[11px] uppercase tracking-wider border-b border-border">
                    <th className="p-4 font-black">Data da Aula</th>
                    <th className="p-4 font-black">Visitante</th>
                    <th className="p-4 font-black">Contato</th>
                    <th className="p-4 font-black">Modalidade</th>
                    <th className="p-4 font-black">Status</th>
                    <th className="p-4 font-black">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leadsHistorico.map(lead => (
                    <tr key={lead.id} className="hover:bg-muted/50 transition-colors">
                      <td className="p-4 text-sm font-bold text-muted-foreground whitespace-nowrap">{formatarDataHora(lead.data_checkin)}</td>
                      <td className="p-4 text-sm font-black text-foreground">{lead.nome}</td>
                      <td className="p-4 text-sm font-medium text-muted-foreground whitespace-nowrap">{lead.telefone || '-'}</td>
                      <td className="p-4">
                        <Badge tone="neutral" variant="soft" className="rounded-md">
                          {lead.agenda?.atividade}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <StatusDropdown
                          lead={lead}
                          onAlterarStatus={alterarStatus}
                          isProcessando={isProcessando(lead.id)}
                        />
                      </td>
                      <td className="p-4 min-w-[220px]">
                        <ObservacaoLead
                          lead={lead}
                          onSalvar={salvarObservacao}
                          isSalvando={isSalvandoObservacao(lead.id)}
                        />
                      </td>
                    </tr>
                  ))}
                  {leadsHistorico.length === 0 && (
                    <tr>
                      <td colSpan="6" className="p-8 text-center text-muted-foreground font-medium">
                        Nenhum histórico registrado{usandoFiltroHistorico ? ' neste período.' : '.'}
                      </td>
                    </tr>
                  )}
                </tbody>
                {!usandoFiltroHistorico && hasNextPage && (
                  <tfoot>
                    <tr>
                      <td colSpan="6" className="p-4 bg-muted/40 text-center border-t border-border">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchNextPage()}
                          disabled={isFetchingNextPage}
                          leftIcon={isFetchingNextPage
                            ? <RefreshCw size={16} className="animate-spin" />
                            : <ChevronDown size={16} />
                          }
                        >
                          {isFetchingNextPage ? 'Carregando mais...' : 'Carregar registros anteriores'}
                        </Button>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Surface>
        </div>
      )}
    </div>
  );
}