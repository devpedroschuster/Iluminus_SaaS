import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dreService } from '../services/dreService';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, Users, AlertCircle,
  ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight,
  Receipt, PiggyBank, BarChart2, Minus,
} from 'lucide-react';
import { format, subMonths, addMonths, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatarMoeda } from '../lib/utils';
import { CORES } from '../lib/constants';
import Surface from '../components/ui/Surface';
import Skeleton from '../components/ui/Skeleton';
import Badge from '../components/ui/Badge';

// Helpers
const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const COR_RECEITA  = '#22c55e'; // green-500
const COR_DESPESA  = '#ef4444'; // red-500
const COR_COMISSAO = '#f59e0b'; // amber-500
const COR_LUCRO    = '#3b82f6'; // blue-500

function sinalTendencia(atual, anterior) {
  if (!anterior || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

// Componentes auxiliares
function CardKPI({ titulo, valor, subtitulo, icone, cor = 'neutral', tendencia = null }) {
  const TONES = {
    success:     'bg-success-soft text-success',
    destructive: 'bg-destructive-soft text-destructive',
    warning:     'bg-warning-soft text-warning',
    info:        'bg-info-soft text-info',
    brand:       'bg-primary-soft text-primary',
    neutral:     'bg-muted text-muted-foreground',
  };
  return (
    <Surface variant="card" padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${TONES[cor]}`}>
          {icone}
        </div>
        {tendencia !== null && (
          <span className={`flex items-center gap-1 text-xs font-black rounded-xl px-2 py-1 ${
            tendencia > 0 ? 'bg-success-soft text-success' :
            tendencia < 0 ? 'bg-destructive-soft text-destructive' :
            'bg-muted text-muted-foreground'
          }`}>
            {tendencia > 0
              ? <ArrowUpRight size={12} />
              : tendencia < 0
              ? <ArrowDownRight size={12} />
              : <Minus size={12} />}
            {Math.abs(tendencia).toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
          {titulo}
        </p>
        <p className="text-2xl font-black text-foreground leading-none">{valor}</p>
        {subtitulo && (
          <p className="mt-1.5 text-xs text-muted-foreground font-medium">{subtitulo}</p>
        )}
      </div>
    </Surface>
  );
}

function LinhaResultado({ label, valor, destaque = false, negativo = false, nivel = 0 }) {
  return (
    <div className={`flex justify-between items-center py-2.5 ${
      nivel > 0 ? `pl-${nivel * 4}` : ''
    } ${destaque ? 'border-t-2 border-border mt-1 pt-3' : ''}`}>
      <span className={`text-sm font-${destaque ? 'black' : 'medium'} ${
        destaque ? 'text-foreground' : 'text-muted-foreground'
      }`}>
        {nivel > 0 && <span className="mr-2 text-border">└</span>}
        {label}
      </span>
      <span className={`text-sm font-black ${
        destaque
          ? negativo ? 'text-destructive' : valor < 0 ? 'text-destructive' : 'text-success'
          : negativo ? 'text-destructive' : 'text-foreground'
      }`}>
        {negativo && valor > 0 ? `(${formatarMoeda(valor)})` : formatarMoeda(Math.abs(valor))}
      </span>
    </div>
  );
}

// ── Tooltip personalizado para os gráficos ────────────────────────────────────
const TooltipStyle = {
  borderRadius: '1rem',
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))',
  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
  fontSize: 13,
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TooltipStyle} className="p-4 min-w-[180px]">
      <p className="font-black text-foreground mb-3 text-sm">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between items-center gap-4 mb-1">
          <span className="text-xs font-bold text-muted-foreground">{p.name}</span>
          <span className="text-xs font-black" style={{ color: p.color }}>
            {formatarMoeda(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ResultadoFinanceiro() {
  const agora = new Date();
  const [mesRef, setMesRef] = useState(new Date(agora.getFullYear(), agora.getMonth(), 1));

  const mes = mesRef.getMonth();   // 0-indexed
  const ano = mesRef.getFullYear();

  const navAnterior = () => setMesRef(m => subMonths(m, 1));
  const navProximo  = () => setMesRef(m => addMonths(m, 1));
  const ehMesAtual  = mes === agora.getMonth() && ano === agora.getFullYear();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: dre, isLoading: loadingDRE } = useQuery({
    queryKey: ['dre', mes, ano],
    queryFn: () => dreService.obterDRE(mes, ano),
    staleTime: 1000 * 60 * 5,
  });

  const { data: historico = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ['dre-historico'],
    queryFn: () => dreService.obterHistorico(6),
    staleTime: 1000 * 60 * 10,
  });

  // ── Tendências (comparação com mês anterior) ───────────────────────────────
  const mesAnteriorKey = format(subMonths(mesRef, 1), 'yyyy-MM');
  const dadosMesAnterior = historico.find(h => h.key === mesAnteriorKey);

  const tendReceitaRecebida = useMemo(() =>
    sinalTendencia(dre?.receitasRecebidas, dadosMesAnterior?.receita),
  [dre, dadosMesAnterior]);

  const tendLucro = useMemo(() =>
    sinalTendencia(dre?.lucroLiquido, dadosMesAnterior?.lucro),
  [dre, dadosMesAnterior]);

  // ── Dados para gráfico de barras agrupadas ─────────────────────────────────
  const dadosBarras = historico.map(h => ({
    mes: h.mes,
    'Receita': parseFloat(h.receita.toFixed(2)),
    'Despesas': parseFloat(h.despesa.toFixed(2)),
    'Comissões': parseFloat(h.comissao.toFixed(2)),
    'Lucro': parseFloat(h.lucro.toFixed(2)),
  }));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-500 bg-background min-h-screen">

      {/* Cabeçalho + Navegação de mês */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary-soft flex items-center justify-center">
              <BarChart2 size={20} className="text-primary" />
            </div>
            Resultado Financeiro
          </h1>
          <p className="text-muted-foreground font-medium mt-1">
            DRE consolidado · Receitas, Despesas e Lucro do espaço
          </p>
        </div>

        {/* Navegador de mês */}
        <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-2 py-1.5 shadow-sm">
          <button
            onClick={navAnterior}
            className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-black text-foreground text-sm w-36 text-center capitalize">
            {format(mesRef, 'MMMM yyyy', { locale: ptBR })}
          </span>
          <button
            onClick={navProximo}
            disabled={ehMesAtual}
            className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* KPIs principais */}
      {loadingDRE ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton.Card key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <CardKPI
            titulo="Receita Recebida"
            valor={formatarMoeda(dre?.receitasRecebidas ?? 0)}
            subtitulo={`${dre?.totalMensalidades ?? 0} mensalidades no período`}
            icone={<TrendingUp size={20} />}
            cor="success"
            tendencia={tendReceitaRecebida}
          />
          <CardKPI
            titulo="Total de Saídas"
            valor={formatarMoeda(dre?.totalSaidas ?? 0)}
            subtitulo={`Despesas + comissões pagas`}
            icone={<TrendingDown size={20} />}
            cor="destructive"
          />
          <CardKPI
            titulo="Lucro Líquido"
            valor={formatarMoeda(dre?.lucroLiquido ?? 0)}
            subtitulo={`Margem: ${(dre?.margemLiquida ?? 0).toFixed(1)}%`}
            icone={<PiggyBank size={20} />}
            cor={dre?.lucroLiquido >= 0 ? 'info' : 'destructive'}
            tendencia={tendLucro}
          />
          <CardKPI
            titulo="Alunos Ativos"
            valor={dre?.totalAlunos ?? 0}
            subtitulo={`${dre?.inadimplentes?.length ?? 0} inadimplentes`}
            icone={<Users size={20} />}
            cor="brand"
          />
        </div>
      )}

      {/* Linha do DRE formal + Valores em aberto */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* DRE Estruturado */}
        <Surface variant="card" padding="none" className="overflow-hidden">
          <div className="p-6 border-b border-border flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
              <Receipt size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="font-black text-foreground text-sm">
                Demonstrativo de Resultado
              </h3>
              <p className="text-xs text-muted-foreground">
                {MESES_PT[mes]} {ano}
              </p>
            </div>
          </div>

          {loadingDRE ? (
            <div className="p-6 space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-6 rounded-lg" />)}
            </div>
          ) : (
            <div className="p-6 divide-y divide-border/50">
              {/* Receitas */}
              <div className="pb-3">
                <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-2">
                  (+) Receitas
                </p>
                <LinhaResultado label="Mensalidades recebidas" valor={dre?.receitasRecebidas ?? 0} nivel={1} />
              </div>

              {/* Deduções */}
              <div className="py-3">
                <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-2">
                  (−) Deduções e Custos
                </p>
                <LinhaResultado label="Despesas pagas" valor={dre?.totalDespesasPagas ?? 0} nivel={1} negativo />
                <LinhaResultado label="Comissões de professores" valor={dre?.totalComissoes ?? 0} nivel={1} negativo />
              </div>

              {/* Resultado */}
              <div className="pt-3 space-y-1">
                <LinhaResultado
                  label="(=) Lucro Líquido do Mês"
                  valor={dre?.lucroLiquido ?? 0}
                  destaque
                />
                <LinhaResultado
                  label="Margem líquida"
                  valor={`${(dre?.margemLiquida ?? 0).toFixed(1)}%`}
                  nivel={1}
                />
              </div>

              {/* A receber */}
              {(dre?.receitasPendentes ?? 0) > 0 && (
                <div className="pt-3">
                  <div className="flex items-center gap-2 p-3 rounded-2xl bg-warning-soft border border-warning/20">
                    <AlertCircle size={16} className="text-warning shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-black text-warning">A receber no mês</p>
                      <p className="text-sm font-black text-warning">
                        {formatarMoeda(dre?.receitasPendentes ?? 0)}
                        <span className="text-xs font-medium ml-1">
                          ({dre?.inadimplentes?.length ?? 0} em atraso)
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Surface>

        {/* Despesas por categoria + Comissões por professor */}
        <div className="space-y-6">

          {/* Despesas por categoria */}
          <Surface variant="card" padding="none" className="overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-black text-foreground text-sm flex items-center gap-2">
                <TrendingDown size={16} className="text-destructive" />
                Despesas por Categoria
              </h3>
            </div>
            {loadingDRE ? (
              <div className="p-5 space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
              </div>
            ) : (dre?.despesasPorCategoria?.length ?? 0) === 0 ? (
              <div className="p-5 text-center text-sm text-muted-foreground py-10">
                Nenhuma despesa no período
              </div>
            ) : (
              <div className="p-5 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                {dre.despesasPorCategoria.map((cat) => (
                  <div key={cat.categoria}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted hover:bg-subtle transition-colors">
                    <span className="text-sm font-bold text-foreground">{cat.categoria}</span>
                    <div className="flex items-center gap-3">
                      {cat.pago > 0 && (
                        <span className="text-xs font-black text-destructive">
                          {formatarMoeda(cat.pago)}
                        </span>
                      )}
                      {cat.pendente > 0 && (
                        <Badge tone="warning" className="text-xs">
                          +{formatarMoeda(cat.pendente)}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Surface>

          {/* Comissões por professor */}
          <Surface variant="card" padding="none" className="overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-black text-foreground text-sm flex items-center gap-2">
                <Users size={16} className="text-primary" />
                Comissões por Professor
              </h3>
            </div>
            {loadingDRE ? (
              <div className="p-5 space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
              </div>
            ) : (dre?.comissoesPorProfessor?.length ?? 0) === 0 ? (
              <div className="p-5 text-center text-sm text-muted-foreground py-10">
                Nenhuma comissão lançada
              </div>
            ) : (
              <div className="p-5 space-y-2">
                {dre.comissoesPorProfessor.map((p) => (
                  <div key={p.nome}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted hover:bg-subtle transition-colors">
                    <span className="text-sm font-bold text-foreground">{p.nome}</span>
                    <span className="text-sm font-black text-primary">{formatarMoeda(p.total)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 border-t border-border">
                  <span className="text-xs font-black text-muted-foreground">TOTAL</span>
                  <span className="text-sm font-black text-foreground">
                    {formatarMoeda(dre?.totalComissoes ?? 0)}
                  </span>
                </div>
              </div>
            )}
          </Surface>
        </div>
      </div>

      {/* Gráfico de evolução */}
      <Surface variant="card" padding="none" className="overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="font-black text-foreground flex items-center gap-2">
            <Wallet size={18} className="text-primary" />
            Evolução Financeira — últimos 6 meses
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Comparativo de receita, despesas e lucro ao longo do tempo
          </p>
        </div>
        <div className="p-6">
          {loadingHistorico ? (
            <Skeleton className="h-72 rounded-2xl" />
          ) : historico.length < 2 ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
              Dados insuficientes para o gráfico
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosBarras} barGap={4} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="mes"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span style={{ color: 'hsl(var(--foreground))', fontSize: 12, fontWeight: 700 }}>
                      {v}
                    </span>
                  )}
                />
                <Bar dataKey="Receita"   fill={COR_RECEITA}  radius={[6, 6, 0, 0]} />
                <Bar dataKey="Despesas"  fill={COR_DESPESA}  radius={[6, 6, 0, 0]} />
                <Bar dataKey="Comissões" fill={COR_COMISSAO} radius={[6, 6, 0, 0]} />
                <Bar dataKey="Lucro"     fill={COR_LUCRO}    radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Surface>

      {/* Tabela de despesas do mês */}
      {(dre?.despesas?.length ?? 0) > 0 && (
        <Surface variant="card" padding="none" className="overflow-hidden">
          <div className="p-6 border-b border-border">
            <h3 className="font-black text-foreground flex items-center gap-2">
              <Receipt size={18} className="text-muted-foreground" />
              Despesas do Período
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-muted text-[10px] font-black uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 rounded-l-2xl">Descrição</th>
                  <th className="px-6 py-4">Categoria</th>
                  <th className="px-6 py-4">Vencimento</th>
                  <th className="px-6 py-4">Valor</th>
                  <th className="px-6 py-4 rounded-r-2xl">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingDRE
                  ? [...Array(3)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-6 py-3">
                        <Skeleton className="h-6 rounded-lg" />
                      </td>
                    </tr>
                  ))
                  : dre.despesas.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-foreground text-sm">{d.descricao}</td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">{d.categoria || '—'}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {d.data_vencimento
                          ? format(new Date(d.data_vencimento + 'T12:00:00'), 'dd/MM/yyyy')
                          : '—'}
                      </td>
                      <td className="px-6 py-4 font-black text-foreground text-sm">
                        {formatarMoeda(d.valor)}
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          tone={d.status === 'pago' ? 'success' : d.status === 'atrasado' ? 'destructive' : 'warning'}
                        >
                          {d.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}