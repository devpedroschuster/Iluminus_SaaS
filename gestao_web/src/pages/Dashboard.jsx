import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboardService';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Users, Activity, TrendingUp, TrendingDown, Wallet,
  MessageCircle, AlertCircle, Clock, CheckCircle2
} from 'lucide-react';
import { subMonths, addDays, format, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { showToast } from '../components/shared/Toast';
import { formatarMoeda } from '../lib/utils';
import { CORES } from '../lib/constants';
import Surface from '../components/ui/Surface';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import Modal, { useModal } from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';

export default function Dashboard() {
  const modalInadimplencia = useModal();
  const agora = new Date();
  const inicioMes = startOfMonth(agora).toISOString();
  const hojeIso = agora.toISOString().split('T')[0];
  const limite7Dias = format(addDays(agora, 7), 'yyyy-MM-dd');
  const dataLimite6Meses = subMonths(agora, 6).toISOString();

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: totalAlunos = 0, isLoading: loadingAlunos } = useQuery({
    queryKey: ['dash-alunos'],
    queryFn: dashboardService.obterTotalAlunos,
  });

  const { data: pagamentosMes = [], isLoading: loadingPagamentos } = useQuery({
    queryKey: ['dash-pagamentos', inicioMes],
    queryFn: () => dashboardService.obterPagamentosMes(inicioMes),
  });

  const { data: listaInadimplentes = [], isLoading: loadingInadimplentes } = useQuery({
    queryKey: ['dash-inadimplentes', hojeIso],
    queryFn: () => dashboardService.obterInadimplentes(hojeIso),
  });

  const { data: presencasComissao = [], isLoading: loadingComissoes } = useQuery({
    queryKey: ['dash-comissoes', inicioMes],
    queryFn: () => dashboardService.obterComissoes(inicioMes),
  });

  const { data: historicoFinanceiro = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ['dash-historico', dataLimite6Meses],
    queryFn: () => dashboardService.obterHistorico(dataLimite6Meses),
  });

  const { data: ultimasAtividades = [], isLoading: loadingAtividades } = useQuery({
    queryKey: ['dash-atividades'],
    queryFn: dashboardService.obterUltimasAtividades,
  });

  const { data: alunosPlanosVencendo = [], isLoading: loadingPlanosVencendo } = useQuery({
    queryKey: ['dash-planos-vencendo', hojeIso, limite7Dias],
    queryFn: () => dashboardService.obterAlunosPlanosVencendo(hojeIso, limite7Dias),
  });

  // ── Derivações ───────────────────────────────────────────────────────────
  const faturamentoMes = useMemo(
    () => pagamentosMes.reduce((acc, curr) => acc + Number(curr.valor_pago), 0),
    [pagamentosMes]
  );

  const metricasInadimplencia = useMemo(() => ({
    count: listaInadimplentes.length,
    valor: listaInadimplentes.reduce((acc, curr) => acc + Number(curr.valor_pago), 0),
  }), [listaInadimplentes]);

  const { totalComissoes, dadosComissoes } = useMemo(() => {
  let total = 0;
  const porProfessor = presencasComissao.reduce((acc, p) => {
    const nomeProf = p.professores?.nome || 'Professor Desconhecido';
    const valor = Number(p.valor) || 0;
    total += valor;
    acc[nomeProf] = (acc[nomeProf] || 0) + valor;
    return acc;
  }, {});

  const formatadas = Object.entries(porProfessor)
    .map(([nome, tot]) => ({ nome, total: tot }))
    .sort((a, b) => b.total - a.total);

  return { totalComissoes: total, dadosComissoes: formatadas };
}, [presencasComissao]);

  // ── Histórico por mês (AreaChart) ────────────────────────────────────────
  const dadosFaturamento = useMemo(() => {
    const faturamentoPorMes = historicoFinanceiro.reduce((acc, m) => {
      const dataSegura = m.data_pagamento?.length === 10
        ? m.data_pagamento + 'T12:00:00'
        : m.data_pagamento;
      const mesKey = m.data_pagamento?.substring(0, 7); // 'yyyy-MM'
      if (!mesKey) return acc;
      const mesFormatado = format(new Date(dataSegura), 'MMM', { locale: ptBR });
      const mes = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);
      acc[mesKey] = { mes, valor: (acc[mesKey]?.valor || 0) + Number(m.valor_pago) };
      return acc;
    }, {});
    return Object.entries(faturamentoPorMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [historicoFinanceiro]);

  // ── Tendência de Receita (mês atual vs anterior) ─────────────────────────
  const { faturamentoMesAnterior, tendenciaReceita } = useMemo(() => {
    const inicioAnterior = format(startOfMonth(subMonths(agora, 1)), 'yyyy-MM-dd');
    const fimAnterior = format(endOfMonth(subMonths(agora, 1)), 'yyyy-MM-dd');
    const total = historicoFinanceiro
      .filter(m => m.data_pagamento >= inicioAnterior && m.data_pagamento <= fimAnterior)
      .reduce((acc, curr) => acc + Number(curr.valor_pago), 0);
    const tendencia = total > 0
      ? ((faturamentoMes - total) / total) * 100
      : null;
    return { faturamentoMesAnterior: total, tendenciaReceita: tendencia };
  }, [historicoFinanceiro, faturamentoMes, agora]);

  // ── Meta do mês (média dos 5 meses anteriores como referência) ───────────
  const percentualMeta = useMemo(() => {
    const mesAtualKey = format(agora, 'yyyy-MM');
    const porMes = historicoFinanceiro.reduce((acc, m) => {
      const mesKey = m.data_pagamento?.substring(0, 7);
      if (!mesKey || mesKey >= mesAtualKey) return acc;
      acc[mesKey] = (acc[mesKey] || 0) + Number(m.valor_pago);
      return acc;
    }, {});
    const valores = Object.values(porMes);
    if (!valores.length) return 0;
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    return media > 0 ? (faturamentoMes / media) * 100 : 0;
  }, [historicoFinanceiro, faturamentoMes, agora]);

  // ── Alertas (Zona 1) ─────────────────────────────────────────────────────
  const alertas = useMemo(() => {
    const lista = [];
    if (!loadingInadimplentes && metricasInadimplencia.count > 0) {
      lista.push({
        tipo: 'danger',
        icon: <AlertCircle size={18} />,
        titulo: `${metricasInadimplencia.count} aluno${metricasInadimplencia.count > 1 ? 's' : ''} com pagamento em atraso`,
        descricao: `${formatarMoeda(metricasInadimplencia.valor)} em aberto — envie cobranças pelo WhatsApp.`,
        acao: { label: 'Ver detalhes', fn: modalInadimplencia.abrir },
      });
    }
    if (!loadingPlanosVencendo && alunosPlanosVencendo.length > 0) {
      const nomes = alunosPlanosVencendo
        .slice(0, 4)
        .map(a => a.nome_completo.split(' ')[0])
        .join(', ');
      const extra = alunosPlanosVencendo.length > 4
        ? ` e mais ${alunosPlanosVencendo.length - 4}`
        : '';
      lista.push({
        tipo: 'warning',
        icon: <Clock size={18} />,
        titulo: `${alunosPlanosVencendo.length} plano${alunosPlanosVencendo.length > 1 ? 's' : ''} vencem nos próximos 7 dias`,
        descricao: `${nomes}${extra} — hora de renovar antes que vença.`,
        acao: null,
      });
    }
    if (!loadingHistorico && percentualMeta >= 80 && faturamentoMes > 0) {
      lista.push({
        tipo: 'success',
        icon: <CheckCircle2 size={18} />,
        titulo: `Meta do mês em dia — ${percentualMeta.toFixed(0)}% da média histórica`,
        descricao: `Você já faturou ${formatarMoeda(faturamentoMes)} esse mês. Continue assim! 🎉`,
        acao: null,
      });
    }
    return lista;
  }, [
    loadingInadimplentes, metricasInadimplencia,
    loadingPlanosVencendo, alunosPlanosVencendo,
    loadingHistorico, percentualMeta, faturamentoMes,
    modalInadimplencia.abrir,
  ]);

  // ── WhatsApp cobrança ─────────────────────────────────────────────────────
  const handleEnviarCobranca = (aluno, dataVencimento, valor) => {
    if (!aluno.telefone) return showToast.error('Este aluno não possui telefone cadastrado.');
    const numeroLimpo = aluno.telefone.replace(/\D/g, '');
    const dataFormatada = format(new Date(dataVencimento + 'T12:00:00'), 'dd/MM/yyyy');
    const texto = `Olá ${aluno.nome_completo.split(' ')[0]}, tudo bem? Aqui é do Espaço Iluminus! Passando para lembrar que consta em nosso sistema uma mensalidade pendente com vencimento em *${dataFormatada}* no valor de *${formatarMoeda(valor)}*. Caso já tenha efetuado o pagamento, por favor desconsidere.`;
    window.open(`https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  // ── Cores de alerta ───────────────────────────────────────────────────────
  const alertaEstilos = {
    danger:  { wrapper: 'bg-destructive-soft border-destructive/30 text-destructive',   btn: 'bg-destructive text-destructive-foreground hover:bg-destructive/90' },
    warning: { wrapper: 'bg-warning-soft border-warning/30 text-warning-foreground',    btn: 'bg-warning text-warning-foreground hover:bg-warning/90' },
    success: { wrapper: 'bg-success-soft border-success/30 text-success-foreground',    btn: 'bg-success text-success-foreground hover:bg-success/90' },
  };

  return (
    <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-500">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Indicadores de performance do Espaço Iluminus.</p>
      </div>

      {/* ── ZONA 1: Alertas Urgentes ──────────────────────────────────────── */}
      {alertas.length > 0 && (
        <div className="space-y-3">
          {alertas.map((alerta, idx) => {
            const estilos = alertaEstilos[alerta.tipo];
            return (
              <div
                key={idx}
                className={`w-full flex items-center justify-between gap-4 p-4 rounded-2xl border ${estilos.wrapper} animate-in slide-in-from-top-2 duration-300`}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0">{alerta.icon}</span>
                  <div className="min-w-0">
                    <p className="font-bold text-sm leading-snug">{alerta.titulo}</p>
                    <p className="text-xs opacity-80 truncate">{alerta.descricao}</p>
                  </div>
                </div>
                {alerta.acao && (
                  <button
                    onClick={alerta.acao.fn}
                    className={`shrink-0 text-xs font-black px-3 py-2 rounded-xl transition-colors ${estilos.btn}`}
                  >
                    {alerta.acao.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── ZONA 2: KPIs do Mês ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {loadingAlunos
          ? <Skeleton.Card />
          : <CardIndicador
              titulo="Alunos Ativos"
              valor={totalAlunos}
              icone={<Users />}
              cor="info"
              tendencia={null}
            />
        }
        {loadingPagamentos || loadingHistorico
          ? <Skeleton.Card />
          : <CardIndicador
              titulo="Receita Mensal"
              valor={formatarMoeda(faturamentoMes)}
              icone={<TrendingUp />}
              cor="success"
              tendencia={tendenciaReceita}
            />
        }
        {loadingComissoes
          ? <Skeleton.Card />
          : <CardIndicador
              titulo="A Pagar (Professores)"
              valor={formatarMoeda(totalComissoes)}
              icone={<Wallet />}
              cor="brand"
              tendencia={null}
            />
        }
        {loadingInadimplentes ? <Skeleton.Card /> : (
          <Surface
            variant="card"
            padding="lg"
            className="border-destructive/20 flex flex-col justify-between hover:shadow-md hover:-translate-y-1 transition-all"
          >
            <div>
              <div className="flex justify-between items-start mb-4">
                <div className="bg-destructive-soft text-destructive p-4 rounded-2xl">
                  <AlertCircle />
                </div>
                <Badge tone="destructive" variant="soft">
                  {metricasInadimplencia.count} atraso{metricasInadimplencia.count !== 1 ? 's' : ''}
                </Badge>
              </div>
              <h3 className="text-3xl font-black text-foreground mb-1">
                {formatarMoeda(metricasInadimplencia.valor)}
              </h3>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Valor em Aberto
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={modalInadimplencia.abrir}
              disabled={metricasInadimplencia.count === 0}
              className="mt-4 w-full text-destructive hover:text-destructive bg-destructive-soft hover:bg-destructive/20"
            >
              Ver Lista Detalhada
            </Button>
          </Surface>
        )}
      </div>

      {/* ── ZONA 3: Gráfico de Receita 6 Meses + Comissões ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {loadingHistorico ? <Skeleton.Card className="h-80" /> : (
          <Surface variant="card" padding="xl">
            <h3 className="font-bold mb-6 text-foreground flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" /> Receita — últimos 6 meses
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dadosFaturamento}>
                  <defs>
                    <linearGradient id="receitaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CORES.amarelo} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={CORES.amarelo} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="mes"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                    contentStyle={{
                      borderRadius: '1rem',
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--card))',
                      color: 'hsl(var(--foreground))',
                      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                    }}
                    formatter={(value) => [formatarMoeda(value), 'Receita']}
                  />
                  <Area
                    type="monotone"
                    dataKey="valor"
                    stroke={CORES.amarelo}
                    strokeWidth={2.5}
                    fill="url(#receitaGradient)"
                    dot={{ fill: CORES.amarelo, strokeWidth: 0, r: 4 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Surface>
        )}

        {/* Ranking de Comissões */}
        <Surface variant="card" padding="none" className="overflow-hidden flex flex-col">
          <div className="p-8 border-b border-border flex justify-between items-center">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Users size={18} className="text-primary" /> Comissões por Professor (Mês)
            </h3>
          </div>
          <div className="flex-1 p-8 overflow-y-auto max-h-64">
            {loadingComissoes ? (
              <div className="space-y-3">
                <Skeleton className="h-12 rounded-2xl" />
                <Skeleton className="h-12 rounded-2xl" />
                <Skeleton className="h-12 rounded-2xl" />
              </div>
            ) : dadosComissoes.length === 0 ? (
              <div className="py-4">
                <EmptyState
                  icon={<Users size={28} />}
                  title="Sem comissões"
                  description="Nenhuma aula registrada neste mês."
                />
              </div>
            ) : (
              <div className="space-y-4">
                {dadosComissoes.map((prof, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-4 bg-muted rounded-2xl hover:bg-subtle transition-colors"
                  >
                    <span className="font-bold text-foreground">{prof.nome}</span>
                    <span className="font-black text-primary">{formatarMoeda(prof.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Surface>
      </div>

      {/* Últimas Transações */}
      <Surface variant="card" padding="xl">
        <h3 className="font-bold mb-6 text-foreground flex items-center gap-2">
          <Activity size={18} className="text-primary" /> Últimas Transações
        </h3>
        {loadingAtividades ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-muted text-[10px] font-black uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 rounded-l-2xl">Aluno</th>
                  <th className="px-6 py-4">Data Pagamento</th>
                  <th className="px-6 py-4">Valor</th>
                  <th className="px-6 py-4 rounded-r-2xl">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ultimasAtividades.length > 0
                  ? ultimasAtividades.map((ativ) => (
                    <tr key={ativ.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-foreground">
                        {ativ.alunos?.nome_completo}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {ativ.data_pagamento
                          ? format(new Date(ativ.data_pagamento + 'T12:00:00'), 'dd/MM/yyyy')
                          : '-'}
                      </td>
                      <td className="px-6 py-4 font-black text-foreground">
                        {formatarMoeda(ativ.valor_pago)}
                      </td>
                      <td className="px-6 py-4">
                        <Badge tone={ativ.status === 'pago' ? 'success' : 'neutral'}>
                          {ativ.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                  : (
                    <tr>
                      <td colSpan="4" className="text-center py-4 text-muted-foreground text-sm">
                        Nenhuma transação recente.
                      </td>
                    </tr>
                  )
                }
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* Modal Inadimplentes */}
      <Modal
        aberto={modalInadimplencia.aberto}
        fechar={modalInadimplencia.fechar}
        title="Detalhamento de Inadimplência"
        size="md"
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-destructive-soft border border-destructive/20 p-4 rounded-2xl flex justify-between items-center mb-6">
            <div>
              <p className="text-sm font-bold text-destructive">Total em atraso</p>
              <h3 className="text-2xl font-black text-destructive">
                {formatarMoeda(metricasInadimplencia.valor)}
              </h3>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-destructive">Alunos</p>
              <h3 className="text-2xl font-black text-destructive">
                {metricasInadimplencia.count}
              </h3>
            </div>
          </div>
          {listaInadimplentes.map(item => (
            <div
              key={item.id}
              className="bg-card border border-border p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-destructive/30 transition-colors"
            >
              <div>
                <h4 className="font-bold text-foreground">{item.alunos?.nome_completo}</h4>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-1 rounded-md">
                    Venc: {format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM/yyyy')}
                  </span>
                  <span className="text-xs font-black text-destructive">
                    {formatarMoeda(item.valor_pago)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleEnviarCobranca(item.alunos, item.data_vencimento, item.valor_pago)}
                className="w-full sm:w-auto bg-[#25D366] text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#20bd5a] transition-colors shadow-sm"
              >
                <MessageCircle size={18} /> Cobrar
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ── CardIndicador ─────────────────────────────────────────────────────────────
const CardIndicador = React.memo(({ titulo, valor, icone, cor, tendencia }) => {
  const estilos = {
    brand:   'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    info:    'bg-info-soft text-info',
  };

  const tendenciaPositiva = tendencia !== null && tendencia >= 0;
  const tendenciaNegativa = tendencia !== null && tendencia < 0;

  return (
    <Surface
      variant="card"
      padding="lg"
      className="hover:shadow-md hover:-translate-y-1 transition-all flex flex-col justify-between"
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`${estilos[cor] ?? estilos.brand} p-3 rounded-2xl`}>
          {icone}
        </div>
        {tendencia !== null && (
          <span
            className={`text-[11px] font-bold flex items-center gap-0.5 px-2 py-1 rounded-lg ${
              tendenciaPositiva
                ? 'bg-success-soft text-success'
                : 'bg-destructive-soft text-destructive'
            }`}
          >
            {tendenciaPositiva
              ? <TrendingUp size={11} />
              : <TrendingDown size={11} />}
            {tendencia > 0 ? '+' : ''}{tendencia.toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <h3 className="text-2xl md:text-3xl font-black text-foreground mb-1 leading-none">{valor}</h3>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{titulo}</p>
        {tendencia !== null && (
          <p className="text-[10px] text-muted-foreground mt-1">vs mês anterior</p>
        )}
      </div>
    </Surface>
  );
});