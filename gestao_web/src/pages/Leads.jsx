import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, CheckCircle, XCircle, Clock, RefreshCw, MessageCircle, LayoutGrid, List, X, ChevronDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import { useLeadsPendentes, useHistoricoLeads, useAtualizarStatusLead } from '../hooks/useLeads';
import Badge   from '../components/ui/Badge';
import Button  from '../components/ui/Button';
import Surface from '../components/ui/Surface';
import EmptyState from '../components/ui/EmptyState';

// Média histórica de referência para comparação (pode ser ajustada conforme o negócio)
const MEDIA_HISTORICA = 0.55;

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
    fetchNextPage,
  } = useHistoricoLeads();
  const mutationStatus = useAtualizarStatusLead();
  const leadsHistorico = historicoData?.pages.flatMap(page => page) || [];

  // ── Métricas do mês atual ──────────────────────────────────────────
  const metricas = useMemo(() => {
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth();

    const doMes = leadsHistorico.filter(lead => {
      const d = new Date(lead.data_checkin);
      return d.getFullYear() === anoAtual && d.getMonth() === mesAtual;
    });

    const total = doMes.length;
    const convertidos = doMes.filter(l => l.status_conversao === 'convertido').length;
    const taxa = total > 0 ? convertidos / total : null;

    return { total, convertidos, taxa };
  }, [leadsHistorico]);

  const comparacaoMedia =
    metricas.taxa === null
      ? null
      : metricas.taxa > MEDIA_HISTORICA
      ? 'acima'
      : metricas.taxa < MEDIA_HISTORICA
      ? 'abaixo'
      : 'igual';

  // ──────────────────────────────────────────────────────────────────

  function marcarComoPerdido(leadId) {
    setConfirmandoId(null);
    mutationStatus.mutate({ id: leadId, status: 'perdido' }, {
      onSuccess: () => showToast.success("Visitante marcado como perdido."),
    });
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
    if (!lead.telefone_visitante) {
      showToast.error("Este visitante não deixou o número de WhatsApp.");
      return;
    }
    const numeroLimpo = lead.telefone_visitante.replace(/\D/g, '');
    const mensagem = encodeURIComponent(
      `Olá ${lead.nome_visitante}, tudo bem? Aqui é do Espaço Iluminus! O que achou da sua aula experimental de ${lead.agenda?.atividade}?`
    );
    window.open(`https://wa.me/55${numeroLimpo}?text=${mensagem}`, '_blank');
  }

  function iniciarMatricula(lead) {
    navigate('/alunos/novo', { state: { leadParaConversao: lead } });
  }

  const isProcessando = (id) => mutationStatus.isPending && mutationStatus.variables?.id === id;
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
            <LayoutGrid size={18} /> Ação ({leadsPendentes.length})
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

      {/* ── Banner de Taxa de Conversão ─────────────────────────────── */}
      {!loadingHistorico && metricas.taxa !== null && (
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
              Este mês:{' '}
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
        /* Visão Cards */
        leadsPendentes.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={28} />}
            title="Caixa de Entrada Zerada!"
            description="Todos os leads já foram contatados ou convertidos."
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
                  <h3 className="font-black text-foreground text-xl leading-tight">{lead.nome_visitante}</h3>
                  <p className="text-xs font-bold text-muted-foreground mt-1">Realizou em: {formatarData(lead.data_checkin)}</p>
                </div>
                <Surface variant="muted" padding="sm" className="mb-6 flex items-center gap-3 rounded-xl border border-border">
                  <MessageCircle size={18} className={lead.telefone_visitante ? "text-success" : "text-muted-foreground"} />
                  <span className={`text-sm font-bold ${lead.telefone_visitante ? "text-foreground" : "text-muted-foreground italic"}`}>
                    {lead.telefone_visitante || "Sem telefone cadastrado"}
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
                    disabled={!lead.telefone_visitante}
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
              </Surface>
            ))}
          </div>
        )
      ) : (
        /* Visão Histórico */
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
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leadsHistorico.map(lead => (
                  <tr key={lead.id} className="hover:bg-muted/50 transition-colors">
                    <td className="p-4 text-sm font-bold text-muted-foreground">{formatarDataHora(lead.data_checkin)}</td>
                    <td className="p-4 text-sm font-black text-foreground">{lead.nome_visitante}</td>
                    <td className="p-4 text-sm font-medium text-muted-foreground">{lead.telefone_visitante || '-'}</td>
                    <td className="p-4">
                      <Badge tone="neutral" variant="soft" className="rounded-md">
                        {lead.agenda?.atividade}
                      </Badge>
                    </td>
                    <td className="p-4">
                      {lead.status_conversao === 'convertido' && (
                        <Badge tone="success" variant="soft">
                          <CheckCircle size={12} /> Convertido
                        </Badge>
                      )}
                      {lead.status_conversao === 'pendente' && (
                        <Badge tone="warning" variant="soft">
                          <Clock size={12} /> Pendente
                        </Badge>
                      )}
                      {lead.status_conversao === 'perdido' && (
                        <Badge tone="destructive" variant="soft">
                          <XCircle size={12} /> Perdido
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {leadsHistorico.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-muted-foreground font-medium">
                      Nenhum histórico registrado.
                    </td>
                  </tr>
                )}
              </tbody>
              {visaoAtiva === 'lista' && hasNextPage && (
                <tfoot>
                  <tr>
                    <td colSpan="5" className="p-4 bg-muted/40 text-center border-t border-border">
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
      )}
    </div>
  );
}