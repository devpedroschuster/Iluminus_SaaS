import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboardService';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { Users, Activity, TrendingUp, Wallet, MessageCircle, AlertCircle } from 'lucide-react';
import { subMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Utilitários e Componentes
import { showToast } from '../components/shared/Toast';
import { CardSkeleton, ChartSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import Modal, { useModal } from '../components/shared/Modal';
import { formatarMoeda } from '../lib/utils';
import { CORES } from '../lib/constants';

export default function Dashboard() {
  const modalInadimplencia = useModal();

  // Datas Base
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
  const faturamentoMes = useMemo(() => pagamentosMes.reduce((acc, curr) => acc + Number(curr.valor_pago), 0), [pagamentosMes]);

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
    const formatadas = Object.entries(porProfessor).map(([nome, tot]) => ({ nome, total: tot })).sort((a, b) => b.total - a.total);
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
    if (!aluno.telefone) return showToast.error("Este aluno não possui telefone cadastrado.");
    const numeroLimpo = aluno.telefone.replace(/\D/g, '');
    const dataFormatada = format(new Date(dataVencimento + 'T12:00:00'), 'dd/MM/yyyy');
    const texto = `Olá ${aluno.nome_completo.split(' ')[0]}, tudo bem? Aqui é do Espaço Iluminus! Passando para lembrar que consta em nosso sistema uma mensalidade pendente com vencimento em *${dataFormatada}* no valor de *${formatarMoeda(valor)}*. Caso já tenha efetuado o pagamento, por favor desconsidere.`;
    window.open(`https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-black text-gray-800 tracking-tight">Dashboard</h1>
        <p className="text-gray-500">Indicadores de performance do Espaço Iluminus.</p>
      </div>

      {/* CARDS DE MÉTRICAS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {loadingAlunos ? <CardSkeleton /> : <CardIndicador titulo="Alunos Ativos" valor={totalAlunos} icone={<Users />} cor="blue" />}
        {loadingPagamentos ? <CardSkeleton /> : <CardIndicador titulo="Receita Mensal" valor={formatarMoeda(faturamentoMes)} icone={<TrendingUp />} cor="green" />}
        {loadingComissoes ? <CardSkeleton /> : <CardIndicador titulo="A Pagar (Professores)" valor={formatarMoeda(totalComissoes)} icone={<Wallet />} cor="orange" />}
        
        {loadingInadimplentes ? <CardSkeleton /> : (
          <div className="bg-white p-6 rounded-[40px] border border-red-100 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 relative group flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-4">
                <div className="bg-red-50 text-red-600 p-4 rounded-2xl"><AlertCircle /></div>
                <span className="bg-red-50 text-red-600 text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1">
                  {metricasInadimplencia.count} ATRASOS
                </span>
              </div>
              <h3 className="text-3xl font-black text-gray-800 mb-1">{formatarMoeda(metricasInadimplencia.valor)}</h3>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Valor em Aberto</p>
            </div>
            <button 
              onClick={modalInadimplencia.abrir}
              disabled={metricasInadimplencia.count === 0}
              className="mt-4 w-full bg-red-50 text-red-600 hover:bg-red-100 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Ver Lista Detalhada
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GRÁFICO DE BARRAS */}
        {loadingHistorico ? <ChartSkeleton /> : (
          <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
            <h3 className="font-bold mb-6 text-gray-700 flex items-center gap-2">
              <TrendingUp size={18} className="text-iluminus-terracota" /> Receita x Tempo
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosFaturamento}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F5" />
                  <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{fill: '#999', fontSize: 12}} />
                  <YAxis hide />
                  <Tooltip cursor={{fill: '#FDF8F5'}} contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}} formatter={(value) => [formatarMoeda(value), 'Receita']} />
                  <Bar dataKey="valor" fill={CORES.terracota} radius={[12, 12, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* RANKING DE COMISSÕES */}
        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="p-8 border-b border-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Users size={18} className="text-iluminus-terracota" /> Comissões por Professor (Mês)
            </h3>
          </div>
          <div className="flex-1 p-8 overflow-y-auto max-h-64">
            {loadingComissoes ? (
               <div className="space-y-4 animate-pulse"><div className="h-10 bg-gray-50 rounded-xl" /></div>
            ) : dadosComissoes.length === 0 ? (
               <div className="py-4"><EmptyState titulo="Sem comissões" mensagem="Nenhuma aula registrada neste mês." /></div>
            ) : (
              <div className="space-y-4">
                {dadosComissoes.map((prof, index) => (
                  <div key={index} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors">
                    <span className="font-bold text-gray-700">{prof.nome}</span>
                    <span className="font-black text-iluminus-terracota">{formatarMoeda(prof.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TABELA: ÚLTIMAS ATIVIDADES FINANCEIRAS */}
      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm mt-8">
        <h3 className="font-bold mb-6 text-gray-700 flex items-center gap-2">
          <Activity size={18} className="text-iluminus-terracota" /> Últimas Transações
        </h3>
        {loadingAtividades ? <div className="animate-pulse h-32 bg-gray-50 rounded-2xl"></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400">
                <tr>
                  <th className="px-6 py-4 rounded-l-2xl">Aluno</th>
                  <th className="px-6 py-4">Data Pagamento</th>
                  <th className="px-6 py-4">Valor</th>
                  <th className="px-6 py-4 rounded-r-2xl">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ultimasAtividades.length > 0 ? ultimasAtividades.map((ativ) => (
                  <tr key={ativ.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-gray-700">{ativ.alunos?.nome_completo}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {ativ.data_pagamento ? format(new Date(ativ.data_pagamento + 'T12:00:00'), 'dd/MM/yyyy') : '-'}
                    </td>
                    <td className="px-6 py-4 font-black text-gray-800">{formatarMoeda(ativ.valor_pago)}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${ativ.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {ativ.status}
                      </span>
                    </td>
                  </tr>
                )) : <tr><td colSpan="4" className="text-center py-4 text-gray-400 text-sm">Nenhuma transação recente.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL INADIMPLENTES */}
      <Modal isOpen={modalInadimplencia.isOpen} onClose={modalInadimplencia.fechar} titulo="Detalhamento de Inadimplência">
        <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex justify-between items-center mb-6">
            <div>
              <p className="text-sm font-bold text-red-800">Total em atraso</p>
              <h3 className="text-2xl font-black text-red-600">{formatarMoeda(metricasInadimplencia.valor)}</h3>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-red-800">Alunos</p>
              <h3 className="text-2xl font-black text-red-600">{metricasInadimplencia.count}</h3>
            </div>
          </div>

          {listaInadimplentes.map(item => (
            <div key={item.id} className="bg-white border border-gray-200 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-red-200 transition-colors">
              <div>
                <h4 className="font-bold text-gray-800">{item.alunos?.nome_completo}</h4>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-md">
                    Venc: {format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM/yyyy')}
                  </span>
                  <span className="text-xs font-black text-red-500">{formatarMoeda(item.valor_pago)}</span>
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

const CardIndicador = React.memo(({ titulo, valor, icone, cor }) => {
  const estilos = {
    orange: "bg-orange-50 text-iluminus-terracota",
    green: "bg-green-50 text-green-600",
    blue: "bg-blue-50 text-blue-600" 
  };
  return (
    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm transition-all hover:shadow-md hover:-translate-y-1">
      <div className="flex justify-between items-start mb-4">
        <div className={`${estilos[cor] || estilos.orange} p-4 rounded-2xl`}>{icone}</div>
      </div>
      <h3 className="text-3xl font-black text-gray-800 mb-1">{valor}</h3>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{titulo}</p>
    </div>
  );
});