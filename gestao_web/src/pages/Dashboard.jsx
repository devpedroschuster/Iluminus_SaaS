import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboardService';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Users, Activity, TrendingUp, Wallet, MessageCircle, AlertCircle } from 'lucide-react';
import { subMonths, format } from 'date-fns';
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
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
  const hojeIso = agora.toISOString().split('T')[0];
  const dataLimite = subMonths(agora, 6).toISOString();

  const { data: totalAlunos = 0, isLoading: loadingAlunos } = useQuery({
    queryKey: ['dash-alunos'],
    queryFn: dashboardService.obterTotalAlunos
  });

  const { data: pagamentosMes = [], isLoading: loadingPagamentos } = useQuery({
    queryKey: ['dash-pagamentos', inicioMes],
    queryFn: () => dashboardService.obterPagamentosMes(inicioMes)
  });
  const faturamentoMes = useMemo(
    () => pagamentosMes.reduce((acc, curr) => acc + Number(curr.valor_pago), 0),
    [pagamentosMes]
  );

  const { data: listaInadimplentes = [], isLoading: loadingInadimplentes } = useQuery({
    queryKey: ['dash-inadimplentes', hojeIso],
    queryFn: () => dashboardService.obterInadimplentes(hojeIso)
  });
  const metricasInadimplencia = useMemo(() => ({
    count: listaInadimplentes.length,
    valor: listaInadimplentes.reduce((acc, curr) => acc + Number(curr.valor_pago), 0)
  }), [listaInadimplentes]);

  const { data: presencasComissao = [], isLoading: loadingComissoes } = useQuery({
    queryKey: ['dash-comissoes', inicioMes],
    queryFn: () => dashboardService.obterComissoes(inicioMes)
  });
  const { totalComissoes, dadosComissoes } = useMemo(() => {
    let total = 0;
    const porProfessor = presencasComissao.reduce((acc, p) => {
      const nomeProf = p.agenda?.professores?.nome || 'Professor Desconhecido';
      const valorAula = Number(p.agenda?.valor_por_aluno) || 0;
      const comissao = valorAula * 0.5;
      total += comissao;
      acc[nomeProf] = (acc[nomeProf] || 0) + comissao;
      return acc;
    }, {});
    const formatadas = Object.entries(porProfessor)
      .map(([nome, tot]) => ({ nome, total: tot }))
      .sort((a, b) => b.total - a.total);
    return { totalComissoes: total, dadosComissoes: formatadas };
  }, [presencasComissao]);

  const { data: historicoFinanceiro = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ['dash-historico', dataLimite],
    queryFn: () => dashboardService.obterHistorico(dataLimite)
  });
  const dadosFaturamento = useMemo(() => {
    const faturamentoPorMes = historicoFinanceiro.reduce((acc, m) => {
      const mesFormatado = format(new Date(m.data_pagamento), 'MMM', { locale: ptBR });
      const mes = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);
      acc[mes] = (acc[mes] || 0) + Number(m.valor_pago);
      return acc;
    }, {});
    return Object.entries(faturamentoPorMes).map(([mes, valor]) => ({ mes, valor }));
  }, [historicoFinanceiro]);

  const { data: ultimasAtividades = [], isLoading: loadingAtividades } = useQuery({
    queryKey: ['dash-atividades'],
    queryFn: dashboardService.obterUltimasAtividades
  });

  const handleEnviarCobranca = (aluno, dataVencimento, valor) => {
    if (!aluno.telefone) return showToast.error('Este aluno não possui telefone cadastrado.');
    const numeroLimpo = aluno.telefone.replace(/\D/g, '');
    const dataFormatada = format(new Date(dataVencimento + 'T12:00:00'), 'dd/MM/yyyy');
    const texto = `Olá ${aluno.nome_completo.split(' ')[0]}, tudo bem? Aqui é do Espaço Iluminus! Passando para lembrar que consta em nosso sistema uma mensalidade pendente com vencimento em *${dataFormatada}* no valor de *${formatarMoeda(valor)}*. Caso já tenha efetuado o pagamento, por favor desconsidere.`;
    window.open(`https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Indicadores de performance do Espaço Iluminus.</p>
      </div>

      {/* CARDS DE MÉTRICAS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {loadingAlunos
          ? <Skeleton.Card />
          : <CardIndicador titulo="Alunos Ativos" valor={totalAlunos} icone={<Users />} cor="info" />
        }
        {loadingPagamentos
          ? <Skeleton.Card />
          : <CardIndicador titulo="Receita Mensal" valor={formatarMoeda(faturamentoMes)} icone={<TrendingUp />} cor="success" />
        }
        {loadingComissoes
          ? <Skeleton.Card />
          : <CardIndicador titulo="A Pagar (Professores)" valor={formatarMoeda(totalComissoes)} icone={<Wallet />} cor="brand" />
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
                  {metricasInadimplencia.count} atrasos
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GRÁFICO DE BARRAS */}
        {loadingHistorico ? <Skeleton.Card className="h-80" /> : (
          <Surface variant="card" padding="xl">
            <h3 className="font-bold mb-6 text-foreground flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" /> Receita x Tempo
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosFaturamento}>
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
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{
                      borderRadius: '1rem',
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--card))',
                      color: 'hsl(var(--foreground))',
                      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
                    }}
                    formatter={(value) => [formatarMoeda(value), 'Receita']}
                  />
                  <Bar dataKey="valor" fill={CORES.amarelo} radius={[12, 12, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Surface>
        )}

        {/* RANKING DE COMISSÕES */}
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

      {/* TABELA: ÚLTIMAS ATIVIDADES FINANCEIRAS */}
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
                          : '-'
                        }
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

      {/* MODAL INADIMPLENTES */}
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

/**
 * Card de KPI reutilizável.
 * cor: 'brand' | 'success' | 'info'
 */
const CardIndicador = React.memo(({ titulo, valor, icone, cor }) => {
  const estilos = {
    brand:   'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    info:    'bg-info-soft text-info',
  };
  return (
    <Surface
      variant="card"
      padding="xl"
      className="hover:shadow-md hover:-translate-y-1 transition-all"
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`${estilos[cor] ?? estilos.brand} p-4 rounded-2xl`}>
          {icone}
        </div>
      </div>
      <h3 className="text-3xl font-black text-foreground mb-1">{valor}</h3>
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{titulo}</p>
    </Surface>
  );
});