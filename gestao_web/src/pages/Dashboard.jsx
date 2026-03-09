import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { Users, DollarSign, Activity, TrendingUp, Package, Wallet } from 'lucide-react';
import { subMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Utilitários e Componentes
import { showToast } from '../components/shared/Toast';
import { CardSkeleton, ChartSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import { formatarMoeda, coresStatus } from '../lib/utils';
import { CORES } from '../lib/constants';

export default function Dashboard() {
  const [metricas, setMetricas] = useState({ 
    totalAlunos: 0, 
    faturamentoMes: 0, 
    inadimplencia: 0,
    totalComissoes: 0 
  });
  const [dadosPlanos, setDadosPlanos] = useState([]);
  const [dadosFaturamento, setDadosFaturamento] = useState([]);
  const [ultimasAtividades, setUltimasAtividades] = useState([]);
  const [dadosComissoes, setDadosComissoes] = useState([]);
  const [loading, setLoading] = useState(true);

  const COLORS = [CORES.terracota, CORES.verde, CORES.bege, CORES.texto];

  useEffect(() => {
    fetchDadosDashboard();
  }, []);

  async function fetchDadosDashboard() {
    setLoading(true);
    try {
      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();

      // 1. Total de Alunos Ativos
      const { count: totalAlunos } = await supabase
        .from('alunos')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true)
        .eq('role', 'aluno');

      // 2. Faturamento do Mês Atual
      const { data: pagamentos } = await supabase
        .from('mensalidades')
        .select('valor_pago')
        .eq('status', 'pago')
        .gte('data_pagamento', inicioMes);
      
      const faturamentoMes = pagamentos?.reduce((acc, curr) => acc + Number(curr.valor_pago), 0) || 0;

      // 3. Cálculo da Inadimplência do Mês Atual
      const { data: mensalidadesMes } = await supabase
        .from('mensalidades')
        .select('status, data_vencimento')
        .gte('data_vencimento', inicioMes);

      let qtdTotalMes = 0;
      let qtdAtrasadas = 0;

      mensalidadesMes?.forEach(m => {
        qtdTotalMes++;
        const vencida = new Date(m.data_vencimento) < agora;
        if ((m.status === 'pendente' && vencida) || m.status === 'atrasado') {
          qtdAtrasadas++;
        }
      });

      const taxaInadimplencia = qtdTotalMes > 0 
        ? ((qtdAtrasadas / qtdTotalMes) * 100).toFixed(1) 
        : 0;

      // 4. Cálculo de Comissões (50% por aluno nas aulas de dança)
      // Usamos inner join com a agenda filtrando pelo mês atual.
      // Ajuste o nome das colunas 'professores' e 'valor_aula' conforme o seu banco de dados.
      const { data: presencasComissao, error: erroComissao } = await supabase
        .from('presencas')
        .select(`
          id,
          agenda!inner (
            id,
            data_hora,
            modalidade,
            valor_por_aluno, 
            professores ( nome )
          )
        `)
        .gte('agenda.data_hora', inicioMes)
        // Se houver outras modalidades além de dança, descomente e ajuste a linha abaixo:
        // .eq('agenda.modalidade', 'Dança');
      
      let totalComissoesMes = 0;
      
      // Agrupamos o valor a ser pago para cada professor
      const comissoesPorProfessor = presencasComissao?.reduce((acc, p) => {
        const nomeProf = p.agenda?.professores?.nome || 'Professor Desconhecido';
        // Caso o valor seja fixo e não esteja no banco, você pode colocar um valor manual aqui. Ex: const valorAula = 60;
        const valorAula = Number(p.agenda?.valor_por_aluno) || 0; 
        const comissao = valorAula * 0.5; // 50% de comissão
        
        totalComissoesMes += comissao;
        acc[nomeProf] = (acc[nomeProf] || 0) + comissao;
        return acc;
      }, {}) || {};

      const comissoesFormatadas = Object.entries(comissoesPorProfessor)
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total); // Ordena do maior para o menor

      setDadosComissoes(comissoesFormatadas);

      // 5. Histórico de Faturamento (Últimos 6 meses)
      const dataLimite = subMonths(new Date(), 6).toISOString();
      const { data: historicoFinanceiro } = await supabase
        .from('mensalidades')
        .select('data_pagamento, valor_pago')
        .eq('status', 'pago')
        .gte('data_pagamento', dataLimite)
        .order('data_pagamento');

      const faturamentoPorMes = historicoFinanceiro?.reduce((acc, m) => {
        const mesFormatado = format(new Date(m.data_pagamento), 'MMM', { locale: ptBR });
        const mes = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);
        acc[mes] = (acc[mes] || 0) + Number(m.valor_pago);
        return acc;
      }, {});

      const historicoFormatado = Object.entries(faturamentoPorMes || {}).map(([mes, valor]) => ({ mes, valor }));

      // 6. Atividades Recentes
      const { data: atividades } = await supabase
        .from('mensalidades')
        .select('id, valor_pago, data_pagamento, status, alunos(nome_completo)')
        .order('data_pagamento', { ascending: false })
        .limit(5);

      // Atualiza os estados finais
      setMetricas({ 
        totalAlunos: totalAlunos || 0, 
        faturamentoMes, 
        inadimplencia: taxaInadimplencia,
        totalComissoes: totalComissoesMes
      });
      setDadosFaturamento(historicoFormatado); 
      setUltimasAtividades(atividades || []);

    } catch (error) {
      console.error("Erro ao carregar Dashboard:", error.message);
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

      {/* CARDS DE MÉTRICAS - ADICIONADO INADIMPLÊNCIA E COMISSÕES */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {loading ? (
          <>
            <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
          </>
        ) : (
          <>
            <CardIndicador titulo="Alunos Ativos" valor={metricas.totalAlunos} icone={<Users />} cor="blue" />
            <CardIndicador titulo="Receita Mensal" valor={formatarMoeda(metricas.faturamentoMes)} icone={<TrendingUp />} cor="green" />
            <CardIndicador titulo="A Pagar (Professores)" valor={formatarMoeda(metricas.totalComissoes)} icone={<Wallet />} cor="orange" />
            <CardIndicador titulo="Inadimplência" valor={`${metricas.inadimplencia}%`} icone={<Activity />} cor="bege" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GRÁFICO DE BARRAS: FATURAMENTO HISTÓRICO */}
        {loading ? <ChartSkeleton /> : (
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
                  <Tooltip 
                    cursor={{fill: '#FDF8F5'}} 
                    contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}} 
                    formatter={(value) => [formatarMoeda(value), 'Receita']}
                  />
                  <Bar dataKey="valor" fill={CORES.terracota} radius={[12, 12, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* RANKING/TABELA DE COMISSÕES */}
        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="p-8 border-b border-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Users size={18} className="text-iluminus-terracota" /> Comissões por Professor (Mês)
            </h3>
          </div>
          
          <div className="flex-1 p-8 overflow-y-auto max-h-64">
            {loading ? (
               <div className="space-y-4 animate-pulse">
                 {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-50 rounded-xl" />)}
               </div>
            ) : dadosComissoes.length === 0 ? (
               <div className="py-4"><EmptyState titulo="Sem comissões" mensagem="Nenhuma aula de dança registrada neste mês." /></div>
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

      {/* TABELA DE ATIVIDADES RECENTES */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex justify-between items-center">
          <h3 className="font-bold text-gray-800">Fluxo Recente de Pagamentos</h3>
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
    bege: "bg-red-50 text-red-600", // Cor mais forte para inadimplência
    blue: "bg-blue-50 text-blue-600" 
  };
  
  return (
    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm transition-all hover:shadow-md hover:-translate-y-1">
      <div className="flex justify-between items-start mb-4">
        <div className={`${estilos[cor] || estilos.orange} p-4 rounded-2xl`}>
          {icone}
        </div>
      </div>
      <h3 className="text-3xl font-black text-gray-800 mb-1">{valor}</h3>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{titulo}</p>
    </div>
  );
});