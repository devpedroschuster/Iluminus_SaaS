import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { Users, Activity, TrendingUp, Wallet, MessageCircle, AlertCircle } from 'lucide-react';
import { subMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Utilitários e Componentes
import { showToast } from '../components/shared/Toast';
import { CardSkeleton, ChartSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import Modal, { useModal } from '../components/shared/Modal';
import { formatarMoeda, coresStatus } from '../lib/utils';
import { CORES } from '../lib/constants';

export default function Dashboard() {
  const [metricas, setMetricas] = useState({ 
    totalAlunos: 0, 
    faturamentoMes: 0, 
    inadimplenciaCount: 0,
    inadimplenciaValor: 0,
    totalComissoes: 0 
  });
  const [dadosFaturamento, setDadosFaturamento] = useState([]);
  const [ultimasAtividades, setUltimasAtividades] = useState([]);
  const [dadosComissoes, setDadosComissoes] = useState([]);
  const [listaInadimplentes, setListaInadimplentes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Hook para o modal de Drill-Down
  const modalInadimplencia = useModal();

  useEffect(() => {
    fetchDadosDashboard();
  }, []);

  async function fetchDadosDashboard() {
    setLoading(true);
    try {
      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
      const hojeIso = agora.toISOString().split('T')[0];

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

      // 3. Drill-Down da Inadimplência (Pendentes e Vencidas)
      const { data: dadosInadimplentes } = await supabase
        .from('mensalidades')
        .select('id, valor_pago, data_vencimento, alunos(nome_completo, telefone)')
        .in('status', ['pendente', 'atrasado'])
        .lt('data_vencimento', hojeIso)
        .order('data_vencimento', { ascending: true });

      const inadimplenciaCount = dadosInadimplentes?.length || 0;
      const inadimplenciaValor = dadosInadimplentes?.reduce((acc, curr) => acc + Number(curr.valor_pago), 0) || 0;

      // 4. Cálculo de Comissões (50% nas aulas)
      const { data: presencasComissao } = await supabase
        .from('presencas')
        .select(`
          id,
          agenda!inner (
            id,
            data_hora,
            valor_por_aluno, 
            professores ( nome )
          )
        `)
        .gte('agenda.data_hora', inicioMes);
      
      let totalComissoesMes = 0;
      const comissoesPorProfessor = presencasComissao?.reduce((acc, p) => {
        const nomeProf = p.agenda?.professores?.nome || 'Professor Desconhecido';
        const valorAula = Number(p.agenda?.valor_por_aluno) || 0; 
        const comissao = valorAula * 0.5; 
        
        totalComissoesMes += comissao;
        acc[nomeProf] = (acc[nomeProf] || 0) + comissao;
        return acc;
      }, {}) || {};

      const comissoesFormatadas = Object.entries(comissoesPorProfessor)
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total);

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
        inadimplenciaCount,
        inadimplenciaValor,
        totalComissoes: totalComissoesMes
      });
      setListaInadimplentes(dadosInadimplentes || []);
      setDadosComissoes(comissoesFormatadas);
      setDadosFaturamento(historicoFormatado); 
      setUltimasAtividades(atividades || []);

    } catch (error) {
      console.error("Erro ao carregar Dashboard:", error.message);
      showToast.error("Erro ao atualizar indicadores.");
    } finally {
      setLoading(false);
    }
  }

  // --- Função para Enviar WhatsApp ---
  const handleEnviarCobranca = (aluno, dataVencimento, valor) => {
    if (!aluno.telefone) {
      showToast.error("Este aluno não possui telefone cadastrado.");
      return;
    }
    
    // Remove tudo que não for número
    const numeroLimpo = aluno.telefone.replace(/\D/g, '');
    const dataFormatada = format(new Date(dataVencimento + 'T12:00:00'), 'dd/MM/yyyy');
    const valorFormatado = formatarMoeda(valor);
    const primeiroNome = aluno.nome_completo.split(' ')[0];

    // Texto da mensagem pré-configurado
    const texto = `Olá ${primeiroNome}, tudo bem? Aqui é do Espaço Iluminus! Passando para lembrar que consta em nosso sistema uma mensalidade pendente com vencimento em *${dataFormatada}* no valor de *${valorFormatado}*. Caso já tenha efetuado o pagamento, por favor desconsidere esta mensagem. Qualquer dúvida, estamos à disposição!`;

    const url = `https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-black text-gray-800 tracking-tight">Dashboard</h1>
        <p className="text-gray-500">Indicadores de performance do Espaço Iluminus.</p>
      </div>

      {/* CARDS DE MÉTRICAS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {loading ? (
          <><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /></>
        ) : (
          <>
            <CardIndicador titulo="Alunos Ativos" valor={metricas.totalAlunos} icone={<Users />} cor="blue" />
            <CardIndicador titulo="Receita Mensal" valor={formatarMoeda(metricas.faturamentoMes)} icone={<TrendingUp />} cor="green" />
            <CardIndicador titulo="A Pagar (Professores)" valor={formatarMoeda(metricas.totalComissoes)} icone={<Wallet />} cor="orange" />
            
            {/* NOVO CARD INADIMPLÊNCIA COM DRILL-DOWN */}
            <div className="bg-white p-6 rounded-[40px] border border-red-100 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 relative group flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-red-50 text-red-600 p-4 rounded-2xl">
                    <AlertCircle />
                  </div>
                  <span className="bg-red-50 text-red-600 text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1">
                    {metricas.inadimplenciaCount} ATRASOS
                  </span>
                </div>
                <h3 className="text-3xl font-black text-gray-800 mb-1">{formatarMoeda(metricas.inadimplenciaValor)}</h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Valor em Aberto</p>
              </div>
              
              <button 
                onClick={modalInadimplencia.abrir}
                disabled={metricas.inadimplenciaCount === 0}
                className="mt-4 w-full bg-red-50 text-red-600 hover:bg-red-100 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ver Lista Detalhada
              </button>
            </div>
          </>
        )}
      </div>

      {/* GRÁFICOS E TABELAS CONTINUAM IGUAIS... */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GRÁFICO DE BARRAS */}
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

        {/* RANKING DE COMISSÕES */}
        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="p-8 border-b border-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Users size={18} className="text-iluminus-terracota" /> Comissões por Professor (Mês)
            </h3>
          </div>
          <div className="flex-1 p-8 overflow-y-auto max-h-64">
            {loading ? (
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

      {/* --- MODAL DE DRILL-DOWN: INADIMPLENTES --- */}
      <Modal isOpen={modalInadimplencia.isOpen} onClose={modalInadimplencia.fechar} titulo="Detalhamento de Inadimplência">
        <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex justify-between items-center mb-6">
            <div>
              <p className="text-sm font-bold text-red-800">Total em atraso</p>
              <h3 className="text-2xl font-black text-red-600">{formatarMoeda(metricas.inadimplenciaValor)}</h3>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-red-800">Alunos</p>
              <h3 className="text-2xl font-black text-red-600">{metricas.inadimplenciaCount}</h3>
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