import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  AlertCircle,
  TrendingUp,
  Clock,
  CheckCircle2,
  Hash,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useRepassesProfessor } from '../../hooks/useRepasses';
import Surface from '../../components/ui/Surface';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';

// ─── helpers ─────────────────────────────────────────────────────────────────

function mesAnoLabel(mesAno) {
  const [ano, mes] = mesAno.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

function navegarMes(mesAno, delta) {
  const [ano, mes] = mesAno.split('-').map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mesAnoAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatarMoeda(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v ?? 0);
}

function formatarData(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function statusBadge(status) {
  if (status === 'pago') return <Badge tone="success">Pago</Badge>;
  if (status === 'cancelado') return <Badge tone="destructive">Cancelado</Badge>;
  return <Badge tone="warning">Pendente</Badge>;
}

function tipoAulaLabel(tipo) {
  const mapa = {
    fixo: 'Aula Fixa',
    avulsa: 'Aula Avulsa',
    reposicao: 'Reposição',
    experimental: 'Experimental',
  };
  return mapa[tipo] ?? tipo ?? '—';
}

// ─── export CSV ──────────────────────────────────────────────────────────────

function exportarCSV(repasses, mesAno) {
  const cabecalho = ['Data', 'Aluno', 'Modalidade', 'Tipo de Aula', 'Valor', 'Status'];
  const linhas = repasses.map(r => [
    formatarData(r.data_referencia),
    r.alunos?.nome_completo ?? '—',
    r.modalidade ?? '—',
    tipoAulaLabel(r.tipo_aula),
    String(r.valor ?? 0).replace('.', ','),
    r.status ?? 'pendente',
  ]);

  const csv = [cabecalho, ...linhas]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `repasses-${mesAno}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KPICard({ icon, label, value, subtitle, tone = 'neutral', loading }) {
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
          <Skeleton className="h-7 w-24 mt-1" />
        ) : (
          <>
            <p className="text-2xl font-black text-foreground">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </>
        )}
      </div>
    </Surface>
  );
}

// ─── página ──────────────────────────────────────────────────────────────────

// R1 FIX — nome do componente alinhado com o nome do arquivo
export default function ProfessorComissoes() {
  const { professorId } = useAuth();
  const [mesAno, setMesAno] = useState(mesAnoAtual);

  // R2 FIX — isError e error desestruturados para feedback visual
  // isPending cobre o estado inicial quando professorId ainda não está disponível
  // (enabled:false → status:'pending' mas isLoading:false no TanStack Query v5)
  const { data: repasses, isLoading, isPending, isError, error } = useRepassesProfessor(professorId, mesAno);
  const carregando = isLoading || isPending;

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!repasses) return { total: 0, confirmado: 0, pendente: 0, qtdTotal: 0, qtdPaga: 0, qtdPendente: 0 };
    return repasses.reduce(
      (acc, r) => {
        const v = r.valor ?? 0;
        acc.total += v;
        acc.qtdTotal += 1;
        if (r.status === 'pago') {
          acc.confirmado += v;
          acc.qtdPaga += 1;
        } else {
          acc.pendente += v;
          acc.qtdPendente += 1;
        }
        return acc;
      },
      { total: 0, confirmado: 0, pendente: 0, qtdTotal: 0, qtdPaga: 0, qtdPendente: 0 }
    );
  }, [repasses]);

  const podeFuturo = mesAno < mesAnoAtual();

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500">

      {/* ── cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          {/* 5.3 Copywriting */}
          <h1 className="text-3xl font-black text-foreground tracking-tight">
            Repasses & Comissões
          </h1>
          <p className="text-muted-foreground font-medium capitalize">
            {mesAnoLabel(mesAno)}
          </p>
        </div>

        {/* ── navegação de mês ── */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMesAno(m => navegarMes(m, -1))}
            aria-label="Mês anterior"
          >
            <ChevronLeft size={18} />
          </Button>
          <span className="min-w-[130px] text-center text-sm font-bold text-foreground capitalize">
            {mesAnoLabel(mesAno)}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMesAno(m => navegarMes(m, 1))}
            disabled={!podeFuturo}
            aria-label="Próximo mês"
          >
            <ChevronRight size={18} />
          </Button>

          {repasses?.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download size={15} />}
              onClick={() => exportarCSV(repasses, mesAno)}
            >
              Exportar CSV
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard
          icon={<TrendingUp size={20} />}
          label="Total a receber"
          value={formatarMoeda(kpis.total)}
          tone="brand"
          loading={carregando}
        />
        <KPICard
          icon={<Hash size={20} />}
          label="Comissões"
          value={`${kpis.qtdTotal}`}
          subtitle={
            carregando
              ? null
              : `${kpis.qtdPaga} recebida${kpis.qtdPaga === 1 ? '' : 's'} · ${kpis.qtdPendente} pendente${kpis.qtdPendente === 1 ? '' : 's'}`
          }
          tone="neutral"
          loading={carregando}
        />
      </div>

      {/* ── erro (R2) ──────────────────────────────────────────────────────── */}
      {isError && (
        <Surface variant="card" className="flex items-center gap-3 p-5 border border-destructive/30 bg-destructive-soft">
          <AlertCircle size={20} className="text-destructive shrink-0" />
          <div>
            <p className="font-bold text-destructive text-sm">Erro ao carregar repasses</p>
            <p className="text-xs text-muted-foreground">
              {error?.message ?? 'Tente novamente em instantes.'}
            </p>
          </div>
        </Surface>
      )}

      {/* ── skeleton ───────────────────────────────────────────────────────── */}
      {carregando && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {/* ── tabela ─────────────────────────────────────────────────────────── */}
      {!carregando && !isError && (
        (repasses ?? []).length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={28} />}
            title={`Nenhum repasse em ${mesAnoLabel(mesAno)}`}
            // 5.3 Copywriting
            description={`Seus repasses de ${mesAnoLabel(mesAno)} aparecerão aqui após o fechamento do mês.`}
          />
        ) : (
          <Surface variant="card" padding="none" className="rounded-[32px] overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-8 py-5">Data</th>
                  <th className="px-8 py-5">Aluno</th>
                  <th className="px-8 py-5">Modalidade / Tipo</th>
                  <th className="px-8 py-5">Valor</th>
                  <th className="px-8 py-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(repasses ?? []).map(r => (
                  <tr key={r.id} className="hover:bg-primary-soft/30 transition-colors">
                    <td className="px-8 py-5 text-sm text-muted-foreground whitespace-nowrap">
                      {formatarData(r.data_referencia)}
                    </td>
                    <td className="px-8 py-5">
                      <p className="font-bold text-foreground">
                        {r.alunos?.nome_completo ?? '—'}
                      </p>
                    </td>
                    <td className="px-8 py-5">
                      <p className="text-sm font-bold text-foreground">{r.modalidade ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{tipoAulaLabel(r.tipo_aula)}</p>
                    </td>
                    <td className="px-8 py-5 font-bold text-foreground whitespace-nowrap">
                      {formatarMoeda(r.valor)}
                    </td>
                    <td className="px-8 py-5">
                      {statusBadge(r.status)}
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