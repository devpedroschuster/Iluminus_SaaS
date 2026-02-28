import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { Users, DollarSign, Activity, TrendingUp, Package } from 'lucide-react';

// Utilitários e Componentes
import { showToast } from '../components/shared/Toast';
import { CardSkeleton, ChartSkeleton } from '../components/shared/Loading'; // Importando ChartSkeleton
import EmptyState from '../components/shared/EmptyState';
import { formatarMoeda, coresStatus } from '../lib/utils';
import { CORES } from '../lib/constants';

export default function Dashboard() {
  const [metricas, setMetricas] = useState({ totalAlunos: 0, faturamentoMes: 0, inadimplencia: 0 });
  const [dadosPlanos, setDadosPlanos] = useState([]);
  const [dadosFaturamento, setDadosFaturamento] = useState([]);
  const [ultimasAtividades, setUltimasAtividades] = useState([]);
  const [loading, setLoading] = useState(true);

  const COLORS = [CORES.terracota, CORES.verde, CORES.bege, CORES.texto];

  useEffect(() => {
    fetchDadosDashboard();
  }, []);

  async function fetchDadosDashboard() {
    setLoading(true);
    try {
      // 1. Total de Alunos Reais e Ativos
      const { count: totalAlunos } = await supabase
        .from('alunos')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true)
        .eq('role', 'aluno');

      // 2. Faturamento do Mês Atual
      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
      
      const { data: pagamentos } = await supabase
        .from('mensalidades')
        .select('valor_pago')
        .eq('status', 'pago')
        .gte('data_pagamento', inicioMes);
      
      const faturamentoMes = pagamentos?.reduce((acc, curr) => acc + Number(curr.valor_pago), 0) || 0;

      // 3. Distribuição de Planos
      const { data: alunos } = await supabase.from('alunos').select('planos(nome)').eq('role', 'aluno').eq('ativo', true);
      const contagem = alunos?.reduce((acc, curr) => {
        const nome = curr.planos?.nome || 'Sem Plano';
        acc[nome] = (acc[nome] || 0) + 1;
        return acc;
      }, {}) || {};
      
      const formatadoPizza = Object.keys(contagem).map(key => ({ name: key, value: contagem[key] }));

      // 4. Atividades Recentes
      const { data: atividades } = await supabase
        .from('mensalidades')
        .select('id, valor_pago, data_pagamento, status, alunos(nome_completo)')
        .order('data_pagamento', { ascending: false })
        .limit(5);

      // 5. Mock de Evolução (Pode ser substituído por query real depois)
      const mockFaturamento = [
        { mes: 'Nov', valor: faturamentoMes * 0.7 },
        { mes: 'Dez', valor: faturamentoMes * 0.8 },
        { mes: 'Jan', valor: faturamentoMes },
      ];

      setMetricas({ totalAlunos: totalAlunos || 0, faturamentoMes });
      setDadosPlanos(formatadoPizza);
      setDadosFaturamento(mockFaturamento);
      setUltimasAtividades(atividades || []);

    } catch (error) {
      console.error(error);
      showToast.error("Erro ao atualizar indicadores.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-black text-gray-800 tracking-tight">Dashboard</h1>
        <p className="text-gray-500">Indicadores de performance do Espaço Iluminus.</p>
      </div>

      {/* CARDS DE MÉTRICAS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <CardIndicador titulo="Alunos Ativos" valor={metricas.totalAlunos} icone={<Users />} cor="orange" />
            <CardIndicador titulo="Receita Mensal" valor={formatarMoeda(metricas.faturamentoMes)} icone={<TrendingUp />} cor="green" />
            <CardIndicador titulo="Taxa de Retenção" valor="94%" icone={<Activity />} cor="bege" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GRÁFICO DE BARRAS */}
        {loading ? <ChartSkeleton /> : (
          <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
            <h3 className="font-bold mb-6 text-gray-700 flex items-center gap-2">
              <TrendingUp size={18} className="text-iluminus-terracota" /> Crescimento Financeiro
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosFaturamento}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F5" />
                  <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{fill: '#999', fontSize: 12}} />
                  <YAxis hide />
                  <Tooltip cursor={{fill: '#FDF8F5'}} contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}} />
                  <Bar dataKey="valor" fill={CORES.terracota} radius={[12, 12, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* GRÁFICO DE PIZZA */}
        {loading ? <ChartSkeleton /> : (
          <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
            <h3 className="font-bold mb-6 text-gray-700 flex items-center gap-2">
              <Package size={18} className="text-iluminus-terracota" /> Mix de Planos
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dadosPlanos} innerRadius={70} outerRadius={90} paddingAngle={8} dataKey="value">
                    {dadosPlanos.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* TABELA DE ATIVIDADES RECENTES */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex justify-between items-center">
          <h3 className="font-bold text-gray-800">Fluxo Recente</h3>
          <button onClick={fetchDadosDashboard} className="text-xs font-bold text-iluminus-terracota hover:underline">Atualizar dados</button>
        </div>
        
        {loading ? (
           <div className="p-6 space-y-4 animate-pulse">
             {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-50 rounded-xl" />)}
           </div>
        ) : (
          <div className="overflow-x-auto">
            {ultimasAtividades.length === 0 ? (
              <div className="py-10"><EmptyState titulo="Sem atividades" mensagem="Nenhum pagamento registrado recentemente." /></div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-gray-50/50 text-[10px] font-black uppercase text-gray-400">
                  <tr>
                    <th className="px-8 py-4">Membro</th>
                    <th className="px-8 py-4">Evento</th>
                    <th className="px-8 py-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ultimasAtividades.map((atv) => (
                    <tr key={atv.id} className="group hover:bg-gray-50/50 transition-colors">
                      <td className="px-8 py-5 font-bold text-gray-700">{atv.alunos?.nome_completo}</td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${
                          atv.status === 'pago' ? coresStatus.pago.bg + ' ' + coresStatus.pago.text : 'bg-gray-100 text-gray-500'
                        }`}>
                          {atv.status === 'pago' ? 'Pagamento Confirmado' : 'Cobrança Gerada'}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-gray-800">{formatarMoeda(atv.valor_pago)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// React.memo para evitar re-render dos cards ao digitar em outros lugares
const CardIndicador = React.memo(({ titulo, valor, icone, cor }) => {
  const estilos = {
    orange: "bg-orange-50 text-iluminus-terracota",
    green: "bg-green-50 text-green-600",
    bege: "bg-orange-50/50 text-orange-800",
    blue: "bg-blue-50 text-blue-600" 
  };
  
  return (
    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm transition-all hover:shadow-md hover:-translate-y-1">
      <div className="flex justify-between items-start mb-4">
        <div className={`${estilos[cor] || estilos.orange} p-4 rounded-2xl`}>
          {icone}
        </div>
        {/* Badge Visual */}
        <span className="bg-green-50 text-green-600 text-[10px] font-black px-2 py-1 rounded-full flex items-center gap-1">
          <TrendingUp size={12} /> +2.5%
        </span>
      </div>
      <h3 className="text-3xl font-black text-gray-800 mb-1">{valor}</h3>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{titulo}</p>
    </div>
  );
});