import React, { useState } from 'react';
import { 
  DollarSign, TrendingUp, CreditCard, Smartphone, 
  Banknote, Clock, CheckCircle, Search, Plus, RefreshCw, AlertCircle
} from 'lucide-react';

// Hooks e Serviços
import { financeiroService } from '../services/financeiroService';
import { useFinanceiro } from '../hooks/useFinanceiro';

// Componentes
import { showToast } from '../components/shared/Toast';
import { useModal } from '../components/shared/Modal';
import Modal from '../components/shared/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import { formatarMoeda } from '../lib/utils';

const METODOS_PAGAMENTO = [
  { valor: 'pix', label: 'PIX', icone: <Smartphone size={16} /> },
  { valor: 'cartao_credito', label: 'Cartão Crédito', icone: <CreditCard size={16} /> },
  { valor: 'cartao_debito', label: 'Cartão Débito', icone: <CreditCard size={16} /> },
  { valor: 'dinheiro', label: 'Dinheiro', icone: <Banknote size={16} /> },
  { valor: 'transferencia', label: 'Transferência', icone: <TrendingUp size={16} /> },
];

const STATUS_CORES = {
  pago: { bg: 'bg-green-100', text: 'text-green-700' },
  pendente: { bg: 'bg-orange-100', text: 'text-orange-700' },
  atrasado: { bg: 'bg-red-100', text: 'text-red-700' }
};

export default function Financeiro() {
  const [busca, setBusca] = useState('');
  const [loadingGerar, setLoadingGerar] = useState(false);
  
  // Estado de filtros
  const [filtros, setFiltros] = useState({
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    status: 'todos'
  });

  // Estado para o pagamento
  const [mensalidadeSelecionada, setMensalidadeSelecionada] = useState(null);
  const [dadosPagamento, setDadosPagamento] = useState({
    metodo: 'pix',
    desconto: 0,
    multa: 0,
    observacoes: ''
  });

  // Hook React Query (busca automática e cache)
  const { mensalidades, loading, refetch } = useFinanceiro({ 
    mes: filtros.mes, 
    ano: filtros.ano 
  });

  const modalBaixa = useModal();

  // Função 1: Gerar Mensalidades em Lote
  async function handleGerarMensalidades() {
    const nomeMes = new Date(0, filtros.mes).toLocaleString('pt-BR', { month: 'long' });
    if (!confirm(`Deseja gerar as cobranças automáticas para ${nomeMes}/${filtros.ano}?`)) return;

    setLoadingGerar(true);
    try {
      await financeiroService.gerarMensalidades(filtros.mes, filtros.ano);
      showToast.success("Cobranças geradas com sucesso!");
      refetch(); // Atualiza a lista na hora
    } catch (err) {
      showToast.error("Erro: Verifique se as cobranças já não foram geradas.");
    } finally {
      setLoadingGerar(false);
    }
  }

  // Função 2: Confirmar Baixa (Pagamento)
  async function confirmarBaixa() {
    try {
      const valorBase = Number(mensalidadeSelecionada.planos?.preco || 0);
      const valorFinal = valorBase - Number(dadosPagamento.desconto) + Number(dadosPagamento.multa);

      await financeiroService.confirmarPagamento(mensalidadeSelecionada.id, {
        valor_pago: valorFinal,
        metodo: dadosPagamento.metodo,
        desconto: dadosPagamento.desconto,
        multa: dadosPagamento.multa,
        observacoes: dadosPagamento.observacoes,
        nome_aluno: mensalidadeSelecionada.alunos?.nome_completo
      });

      showToast.success("Pagamento registrado!");
      modalBaixa.fechar();
      refetch();
    } catch (err) {
      showToast.error("Erro ao registrar pagamento.");
      console.error(err);
    }
  }

  // Cálculos de Totais (Front-end)
  const totais = mensalidades.reduce((acc, m) => {
    const valor = Number(m.planos?.preco || 0);
    if (m.status === 'pago') acc.recebido += Number(m.valor_pago || valor);
    else acc.pendente += valor;
    return acc;
  }, { recebido: 0, pendente: 0 });

  // Filtragem local (Busca por nome)
  const mensalidadesFiltradas = mensalidades.filter(m => {
    const matchBusca = m.alunos?.nome_completo?.toLowerCase().includes(busca.toLowerCase());
    const matchStatus = filtros.status === 'todos' || m.status === filtros.status;
    return matchBusca && matchStatus;
  });

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Financeiro</h1>
          <p className="text-gray-500">Gestão de mensalidades e caixa.</p>
        </div>
        
        <button 
          onClick={handleGerarMensalidades}
          disabled={loadingGerar}
          className="bg-gray-800 text-white px-6 py-4 rounded-[22px] font-black shadow-lg hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {loadingGerar ? <RefreshCw className="animate-spin" size={20} /> : <Plus size={20} />}
          Gerar Cobranças do Mês
        </button>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <CardMetrica titulo="Recebido" valor={formatarMoeda(totais.recebido)} icone={<CheckCircle />} cor="green" />
        <CardMetrica titulo="Pendente" valor={formatarMoeda(totais.pendente)} icone={<Clock />} cor="orange" />
        <CardMetrica titulo="Total Previsto" valor={formatarMoeda(totais.recebido + totais.pendente)} icone={<DollarSign />} cor="blue" />
      </div>

      {/* Barra de Filtros */}
      <div className="bg-white p-6 rounded-[35px] border border-gray-100 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="flex gap-2">
            <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl font-bold text-sm outline-none cursor-pointer"
            value={filtros.mes}
            onChange={e => setFiltros({...filtros, mes: parseInt(e.target.value)})}
            >
            {Array.from({length: 12}).map((_, i) => (
                <option key={i} value={i}>{new Date(0, i).toLocaleString('pt-BR', {month: 'long'})}</option>
            ))}
            </select>
            <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl font-bold text-sm outline-none cursor-pointer"
            value={filtros.ano}
            onChange={e => setFiltros({...filtros, ano: parseInt(e.target.value)})}
            >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            </select>
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
          <input 
            placeholder="Buscar aluno..."
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl border-none outline-none font-medium"
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
            <div className="p-4"><TableSkeleton /></div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400">
              <tr>
                <th className="px-8 py-5">Aluno / Plano</th>
                <th className="px-8 py-5">Vencimento</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mensalidadesFiltradas.length > 0 ? (
                mensalidadesFiltradas.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-8 py-5">
                      <p className="font-bold text-gray-700">{m.alunos?.nome_completo}</p>
                      <p className="text-[10px] text-gray-400 font-bold uppercase">{m.planos?.nome}</p>
                    </td>
                    <td className="px-8 py-5 font-medium text-gray-500">
                      {new Date(m.data_vencimento).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-8 py-5">
                      <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${STATUS_CORES[m.status]?.bg} ${STATUS_CORES[m.status]?.text}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      {m.status !== 'pago' ? (
                        <button 
                          onClick={() => { 
                            setMensalidadeSelecionada(m); 
                            setDadosPagamento({ metodo: 'pix', desconto: 0, multa: 0, observacoes: '' });
                            modalBaixa.abrir(); 
                          }}
                          className="bg-gray-800 text-white px-4 py-2 rounded-xl font-bold text-xs hover:bg-black transition-all"
                        >
                          Dar Baixa
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs font-bold flex items-center justify-end gap-1">
                          <CheckCircle size={14}/> Pago
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4"><EmptyState titulo="Nenhuma cobrança encontrada" mensagem="Tente mudar o mês ou gere novas cobranças." /></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de Pagamento */}
      <Modal isOpen={modalBaixa.isOpen} onClose={modalBaixa.fechar} titulo="Registrar Pagamento">
        <div className="space-y-6 pt-2">
          <div className="bg-orange-50 p-6 rounded-[32px] text-center">
            <p className="text-xs font-black text-gray-400 uppercase mb-1">Valor Original</p>
            <p className="text-3xl font-black text-iluminus-terracota">{formatarMoeda(mensalidadeSelecionada?.planos?.preco)}</p>
            <p className="text-sm text-gray-500 font-medium mt-1">{mensalidadeSelecionada?.alunos?.nome_completo}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Desconto (R$)</label>
              <input 
                type="number"
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 outline-none font-bold"
                value={dadosPagamento.desconto}
                onChange={e => setDadosPagamento({...dadosPagamento, desconto: e.target.value})}
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Multa (R$)</label>
              <input 
                type="number"
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 outline-none font-bold"
                value={dadosPagamento.multa}
                onChange={e => setDadosPagamento({...dadosPagamento, multa: e.target.value})}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Forma de Pagamento</label>
            <select 
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 outline-none font-bold text-gray-700"
                value={dadosPagamento.metodo}
                onChange={e => setDadosPagamento({...dadosPagamento, metodo: e.target.value})}
            >
                {METODOS_PAGAMENTO.map(met => (
                <option key={met.valor} value={met.valor}>{met.label}</option>
                ))}
            </select>
          </div>

          <button 
            onClick={confirmarBaixa}
            className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all"
          >
            Confirmar Recebimento
          </button>
        </div>
      </Modal>
    </div>
  );
}

const CardMetrica = React.memo(({ titulo, valor, icone, cor }) => {
  const cores = {
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    blue: "bg-blue-50 text-blue-600"
  };
  return (
    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
      <div className={`${cores[cor]} w-12 h-12 rounded-2xl flex items-center justify-center mb-4`}>{icone}</div>
      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">{titulo}</p>
      <h2 className="text-3xl font-black text-gray-800 mt-1">{valor}</h2>
    </div>
  );
});