import React, { useMemo, useState } from 'react';
import { Users, TrendingUp, Percent as PercentIcon, MessageSquare, Calendar, ChevronDown } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLeadsProfessor } from '../../hooks/useLeads';
import Surface from '../../components/ui/Surface';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';

const TODOS_PERIODOS = 'todos';

function formatarData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function chaveMes(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function labelMes(chave) {
  const [ano, mes] = chave.split('-').map(Number);
  const label = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function statusBadge(status) {
  if (status === 'convertido') return <Badge tone="success">Convertido</Badge>;
  if (status === 'perdido') return <Badge tone="destructive">Perdido</Badge>;
  return <Badge tone="warning">Pendente</Badge>;
}

function KPICard({ icon, label, value, tone = 'neutral', loading }) {
  const toneClasses = {
    brand: 'text-primary bg-primary-soft',
    success: 'text-success bg-success-soft',
    warning: 'text-warning bg-warning-soft',
    neutral: 'text-muted-foreground bg-muted',
  };
  return (
    <Surface variant="card" className="flex items-center gap-4 p-6">
      <span className={`rounded-2xl p-3 ${toneClasses[tone]}`}>{icon}</span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <p className="text-2xl font-black text-foreground">{value}</p>
        )}
      </div>
    </Surface>
  );
}

// ─── página ──────────────────────────────────────────────────────────────────
// Somente leitura: o professor visualiza as experimentais das suas próprias
// aulas, quantas converteram e a observação registrada pela administração
// (ex: "não fechou por preço"). Ele não edita status nem observação — isso
// continua sendo responsabilidade da administração em /leads.
export default function ProfessorLeads() {
  const { professorId } = useAuth();
  const [periodo, setPeriodo] = useState(TODOS_PERIODOS);

  const { data: leads, isLoading, isPending, isError, error } = useLeadsProfessor(professorId);
  const carregando = isLoading || isPending;

  const meses = useMemo(() => {
    if (!leads) return [];
    const set = new Set(leads.map(l => chaveMes(l.data_checkin)));
    return [...set].sort().reverse();
  }, [leads]);

  const leadsFiltrados = useMemo(() => {
    if (!leads) return [];
    if (periodo === TODOS_PERIODOS) return leads;
    return leads.filter(l => chaveMes(l.data_checkin) === periodo);
  }, [leads, periodo]);

  const kpis = useMemo(() => {
    const total = leadsFiltrados.length;
    const convertidos = leadsFiltrados.filter(l => l.status_conversao === 'convertido').length;
    const taxa = total > 0 ? (convertidos / total) * 100 : null;
    return { total, convertidos, taxa };
  }, [leadsFiltrados]);

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500">
      {/* cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">Meus Leads</h1>
          <p className="text-muted-foreground font-medium">
            Experimentais das suas aulas e conversões.
          </p>
        </div>

        {meses.length > 0 && (
          <div className="relative">
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className="appearance-none bg-card border border-border rounded-xl pl-10 pr-9 py-2.5 text-sm font-bold text-foreground cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value={TODOS_PERIODOS}>Todos os períodos</option>
              {meses.map(chave => (
                <option key={chave} value={chave}>{labelMes(chave)}</option>
              ))}
            </select>
            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard icon={<Users size={20} />} label="Experimentais" value={kpis.total} tone="brand" loading={carregando} />
        <KPICard icon={<TrendingUp size={20} />} label="Convertidas" value={kpis.convertidos} tone="success" loading={carregando} />
        <KPICard
          icon={<PercentIcon size={20} />}
          label="Taxa de conversão"
          value={kpis.taxa === null ? '—' : `${kpis.taxa.toFixed(0)}%`}
          tone="neutral"
          loading={carregando}
        />
      </div>

      {/* erro */}
      {isError && (
        <Surface variant="card" className="flex items-center gap-3 p-5 border border-destructive/30 bg-destructive-soft">
          <div>
            <p className="font-bold text-destructive text-sm">Erro ao carregar leads</p>
            <p className="text-xs text-muted-foreground">
              {error?.message ?? 'Tente novamente em instantes.'}
            </p>
          </div>
        </Surface>
      )}

      {/* skeleton */}
      {carregando && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {/* tabela */}
      {!carregando && !isError && (
        leadsFiltrados.length === 0 ? (
          <EmptyState
            icon={<Users size={28} />}
            title="Nenhum lead encontrado"
            description="Os leads das suas aulas experimentais aparecerão aqui."
          />
        ) : (
          <Surface variant="card" padding="none" className="rounded-[32px] overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-8 py-5">Data</th>
                  <th className="px-8 py-5">Nome</th>
                  <th className="px-8 py-5">Aula</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leadsFiltrados.map(l => (
                  <tr key={l.id} className="hover:bg-primary-soft/30 transition-colors">
                    <td className="px-8 py-5 text-sm text-muted-foreground whitespace-nowrap">
                      {formatarData(l.data_checkin)}
                    </td>
                    <td className="px-8 py-5">
                      <p className="font-bold text-foreground">{l.nome}</p>
                    </td>
                    <td className="px-8 py-5 text-sm text-muted-foreground">
                      {l.agenda?.atividade ?? '—'}
                    </td>
                    <td className="px-8 py-5">{statusBadge(l.status_conversao)}</td>
                    <td className="px-8 py-5 max-w-xs">
                      {l.observacao ? (
                        <p className="text-xs text-muted-foreground italic flex items-start gap-1.5">
                          <MessageSquare size={13} className="shrink-0 mt-0.5" />
                          {l.observacao}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        )
      )}
    </div>
  );
}