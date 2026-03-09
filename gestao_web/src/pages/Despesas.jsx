import React, { useEffect, useState } from 'react';
import { 
  Plus, Trash2, Edit2, DollarSign, Calendar, 
  TrendingDown, AlertCircle, Filter, Download,
  Zap, Droplet, Wifi, Users, Wrench, ShoppingCart,
  Home, CreditCard, FileText, RefreshCw, Tag
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Serviços e Componentes
import { despesasService } from '../services/despesasService';
import { showToast } from '../components/shared/Toast';
import { ModalConfirmacao, useModal } from '../components/shared/Modal';
import Modal from '../components/shared/Modal';
import { TableSkeleton, CardSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import { formatarMoeda, formatarData } from '../lib/utils';

// Categorias de despesas
const CATEGORIAS_DESPESA = [
  { valor: 'energia', label: 'Energia Elétrica', icone: <Zap size={16} /> },
  { valor: 'agua', label: 'Água', icone: <Droplet size={16} /> },
  { valor: 'internet', label: 'Internet', icone: <Wifi size={16} /> },
  { valor: 'salarios', label: 'Salários/Comissões', icone: <Users size={16} /> },
  { valor: 'manutencao', label: 'Manutenção', icone: <Wrench size={16} /> },
  { valor: 'equipamentos', label: 'Equipamentos', icone: <ShoppingCart size={16} /> },
  { valor: 'aluguel', label: 'Aluguel', icone: <Home size={16} /> },
  { valor: 'impostos', label: 'Impostos', icone: <FileText size={16} /> },
  { valor: 'marketing', label: 'Marketing', icone: <TrendingDown size={16} /> },
  { valor: 'outros', label: 'Outros', icone: <CreditCard size={16} /> },
];

const STATUS_DESPESA = [
  { valor: 'pago', label: 'Pago', cor: 'green' },
  { valor: 'pendente', label: 'Pendente', cor: 'yellow' },
  { valor: 'atrasado', label: 'Atrasado', cor: 'red' },
];

export default function Despesas() {
  const [despesas, setDespesas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [processandoAcao, setProcessandoAcao] = useState(false);

  const [metricas, setMetricas] = useState({
    totalMes: 0,
    pendentes: 0,
    porCategoria: []
  });

  const [filtros, setFiltros] = useState({
    mes: new Date().getMonth(),
    ano: new Date().getFullYear(),
    categoria: 'todas',
    status: 'todos'
  });

  const [formDespesa, setFormDespesa] = useState({
    id: null,
    descricao: '',
    categoria: 'outros',
    valor: '',
    data_vencimento: '',
    status: 'pendente',
    recorrente: false,
    observacoes: ''
  });

  const [despesaEditando, setDespesaEditando] = useState(null);
  const [despesaExcluir, setDespesaExcluir] = useState(null);

  const modalNova = useModal();
  const modalExcluir = useModal();

  useEffect(() => {
    fetchDespesas();
  }, [filtros.mes, filtros.ano]);

  async function fetchDespesas() {
    setLoading(true);
    try {
      const dados = await despesasService.listar(filtros.mes, filtros.ano);
      setDespesas(dados || []);
      calcularMetricas(dados || []);
    } catch (err) {
      showToast.error("Erro ao carregar despesas.");
    } finally {
      setLoading(false);
    }
  }

  function calcularMetricas(dados) {
    const totalMes = dados
      .filter(d => d.status === 'pago')
      .reduce((acc, curr) => acc + Number(curr.valor), 0);
    
    const pendentes = dados
      .filter(d => d.status === 'pendente' || d.status === 'atrasado')
      .reduce((acc, curr) => acc + Number(curr.valor), 0);

    const porCategoria = CATEGORIAS_DESPESA.map(cat => {
      const total = dados
        .filter(d => d.categoria === cat.valor && d.status === 'pago')
        .reduce((acc, curr) => acc + Number(curr.valor), 0);
      
      return {
        categoria: cat.label,
        valor: total,
        icone: cat.icone
      };
    }).filter(c => c.valor > 0);

    setMetricas({ totalMes, pendentes, porCategoria });
  }

  async function salvarDespesa(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    
    try {
      const despesaData = {
        ...formDespesa,
        valor: Number(formDespesa.valor)
      };

      await despesasService.salvar(despesaData);
      showToast.success(formDespesa.id ? "Despesa atualizada!" : "Despesa cadastrada!");

      modalNova.fechar();
      resetForm();
      fetchDespesas();
    } catch (err) {
      showToast.error("Erro ao salvar despesa.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirDespesa() {
    if (processandoAcao || !despesaExcluir) return;
    setProcessandoAcao(true);

    try {
      await despesasService.excluir(despesaExcluir.id);
      showToast.success("Despesa excluída!");
      modalExcluir.fechar();
      setDespesaExcluir(null);
      fetchDespesas();
    } catch (err) {
      showToast.error("Erro ao excluir despesa.");
    } finally {
      setProcessandoAcao(false);
    }
  }

  async function marcarComoPago(despesa) {
    if (processandoAcao) return;
    setProcessandoAcao(true);

    try {
      await despesasService.registrarPagamento(despesa.id);
      showToast.success("Despesa marcada como paga!");
      fetchDespesas();
    } catch (err) {
      showToast.error("Erro ao atualizar status.");
    } finally {
      setProcessandoAcao(false);
    }
  }

  function abrirEdicao(despesa) {
    setDespesaEditando(despesa);
    setFormDespesa({
      id: despesa.id,
      descricao: despesa.descricao,
      categoria: despesa.categoria || 'outros',
      valor: despesa.valor,
      data_vencimento: despesa.data_vencimento?.split('T')[0] || '',
      status: despesa.status,
      recorrente: despesa.recorrente || false,
      observacoes: despesa.observacoes || ''
    });
    modalNova.abrir();
  }

  function resetForm() {
    setDespesaEditando(null);
    setFormDespesa({
      id: null,
      descricao: '',
      categoria: 'outros',
      valor: '',
      data_vencimento: '',
      status: 'pendente',
      recorrente: false,
      observacoes: ''
    });
  }

  function exportarRelatorio() {
    if (despesasFiltradas.length === 0) {
      showToast.error("Não há dados para exportar com os filtros atuais.");
      return;
    }

    const dadosExport = despesasFiltradas.map(d => ({
      'Descrição': d.descricao,
      'Categoria': CATEGORIAS_DESPESA.find(c => c.valor === d.categoria)?.label || 'Outros',
      'Valor': `R$ ${Number(d.valor).toFixed(2).replace('.', ',')}`,
      'Vencimento': new Date(d.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR'),
      'Status': d.status.toUpperCase(),
      'Data Pagamento': d.data_pagamento ? new Date(d.data_pagamento).toLocaleDateString('pt-BR') : '-',
      'Recorrente': d.recorrente ? 'SIM' : 'NÃO',
      'Observações': d.observacoes || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(dadosExport);
    const colWidths = [{ wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 30 }];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Despesas');
    
    const nomeMes = new Date(0, filtros.mes).toLocaleString('pt-BR', { month: 'long' });
    XLSX.writeFile(wb, `Despesas_${nomeMes}_${filtros.ano}.xlsx`);
    showToast.success("Relatório exportado com sucesso!");
  }

  // Aplicar filtros
  const despesasFiltradas = despesas.filter(d => {
    const matchCategoria = filtros.categoria === 'todas' || d.categoria === filtros.categoria;
    
    // Filtro para status
    let matchStatus = true;
    if (filtros.status === 'pendente') {
      matchStatus = d.status === 'pendente' || d.status === 'atrasado';
    } else if (filtros.status !== 'todos') {
      matchStatus = d.status === filtros.status;
    }
    
    return matchCategoria && matchStatus;
  });

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Despesas</h1>
          <p className="text-gray-500">Controle de custos operacionais do estúdio.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={exportarRelatorio}
            disabled={despesasFiltradas.length === 0}
            className="flex items-center gap-2 bg-white border border-gray-200 px-5 py-3 rounded-2xl font-bold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            <Download size={18} /> Exportar Excel
          </button>
          <button 
            onClick={() => { resetForm(); modalNova.abrir(); }}
            className="flex items-center gap-2 bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:brightness-95 transition-all"
          >
            <Plus size={18} /> Nova Despesa
          </button>
        </div>
      </div>

      {/* Métricas */}
      {loading ? <CardSkeleton /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
            <div className="bg-red-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-red-600">
              <TrendingDown />
            </div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Total Gasto (Pago)</p>
            <h2 className="text-3xl font-black text-gray-800">{formatarMoeda(metricas.totalMes)}</h2>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
            <div className="bg-orange-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-orange-600">
              <AlertCircle />
            </div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Pendente / Atrasado</p>
            <h2 className="text-3xl font-black text-gray-800">{formatarMoeda(metricas.pendentes)}</h2>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
            <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-blue-600">
              <FileText />
            </div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Qtd. de Lançamentos</p>
            <h2 className="text-3xl font-black text-gray-800">{despesas.length}</h2>
          </div>
        </div>
      )}

      {/* Distribuição por Categoria */}
      {metricas.porCategoria.length > 0 && (
        <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-6">Gastos por Categoria (Pagos)</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {metricas.porCategoria.map((cat, idx) => (
              <div key={idx} className="bg-gray-50 p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-gray-600">
                  {cat.icone}
                  <span className="text-xs font-bold truncate">{cat.categoria}</span>
                </div>
                <p className="text-xl font-black text-gray-800">{formatarMoeda(cat.valor)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white p-6 rounded-[28px] border border-gray-100 shadow-sm">
        <div className="flex flex-wrap gap-4">
          <div className="flex gap-2">
            <select 
              className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-transparent outline-none cursor-pointer"
              value={filtros.mes}
              onChange={(e) => setFiltros({...filtros, mes: Number(e.target.value)})}
            >
              {Array.from({length: 12}, (_, i) => (
                <option key={i} value={i}>{new Date(2024, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}</option>
              ))}
            </select>
            <select 
              className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-transparent outline-none cursor-pointer"
              value={filtros.ano}
              onChange={(e) => setFiltros({...filtros, ano: Number(e.target.value)})}
            >
              <option value={2024}>2024</option>
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
            </select>
          </div>

          <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-transparent outline-none cursor-pointer flex-1 min-w-[150px]"
            value={filtros.categoria}
            onChange={(e) => setFiltros({...filtros, categoria: e.target.value})}
          >
            <option value="todas">Todas as Categorias</option>
            {CATEGORIAS_DESPESA.map(cat => <option key={cat.valor} value={cat.valor}>{cat.label}</option>)}
          </select>

          <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-transparent outline-none cursor-pointer flex-1 min-w-[150px]"
            value={filtros.status}
            onChange={(e) => setFiltros({...filtros, status: e.target.value})}
          >
            <option value="todos">Todos os Status</option>
            <option value="pago">Apenas Pagos</option>
            <option value="pendente">Pendentes/Atrasados</option>
          </select>
        </div>
      </div>

      {/* Tabela de Despesas */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden min-h-[400px]">
        {loading ? <TableSkeleton /> : despesasFiltradas.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 mt-10">
            <EmptyState titulo="Nenhuma despesa encontrada" mensagem="Nenhum lançamento corresponde aos filtros selecionados." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-gray-50/50 text-[10px] font-black uppercase text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="px-8 py-5">Descrição</th>
                  <th className="px-8 py-5">Categoria</th>
                  <th className="px-8 py-5">Vencimento</th>
                  <th className="px-8 py-5">Valor</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {despesasFiltradas.map(d => {
                  const categoria = CATEGORIAS_DESPESA.find(c => c.valor === d.categoria) || { label: 'Outros', icone: <CreditCard size={16}/> };
                  const statusCor = STATUS_DESPESA.find(s => s.valor === d.status);

                  return (
                    <tr key={d.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <p className="font-bold text-gray-800">{d.descricao}</p>
                          {d.recorrente && (
                            <span className="text-[9px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase w-fit mt-1">
                              Recorrente
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2 text-gray-500">
                          {categoria.icone}
                          <span className="text-xs font-bold uppercase">{categoria.label}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 font-bold text-gray-600">
                        {new Date(d.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-8 py-5 font-black text-red-500">
                        {formatarMoeda(d.valor)}
                      </td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                          statusCor?.cor === 'green' ? 'bg-green-100 text-green-700' :
                          statusCor?.cor === 'yellow' ? 'bg-orange-100 text-orange-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex justify-end gap-2 items-center">
                          {d.status !== 'pago' ? (
                            <button 
                              onClick={() => marcarComoPago(d)}
                              disabled={processandoAcao}
                              className="bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-green-700 transition-colors mr-2 shadow-sm disabled:opacity-50"
                            >
                              Dar Baixa
                            </button>
                          ) : (
                            <span className="text-xs font-bold text-gray-400 mr-4">Pago em {d.data_pagamento ? new Date(d.data_pagamento + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                          )}
                          
                          <button onClick={() => abrirEdicao(d)} className="p-2 text-gray-400 hover:text-blue-600 bg-white rounded-lg border border-gray-100 shadow-sm transition-colors" title="Editar">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => { setDespesaExcluir(d); modalExcluir.abrir(); }} className="p-2 text-gray-400 hover:text-red-600 bg-white rounded-lg border border-gray-100 shadow-sm transition-colors" title="Excluir">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={modalNova.isOpen} onClose={() => { modalNova.fechar(); resetForm(); }} titulo={despesaEditando ? "Editar Despesa" : "Nova Despesa"}>
        <form onSubmit={salvarDespesa} className="space-y-4 pt-2">
          
          <input
            required
            placeholder="Descrição da conta (ex: Luz, Aluguel)"
            className="w-full p-4 bg-gray-50 rounded-2xl border border-transparent focus:border-red-200 outline-none font-bold text-gray-700"
            value={formDespesa.descricao}
            onChange={e => setFormDespesa({...formDespesa, descricao: e.target.value})}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Categoria</label>
              <select
                required
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 border border-transparent focus:border-red-200 outline-none font-bold text-gray-600 cursor-pointer"
                value={formDespesa.categoria}
                onChange={e => setFormDespesa({...formDespesa, categoria: e.target.value})}
              >
                {CATEGORIAS_DESPESA.map(cat => <option key={cat.valor} value={cat.valor}>{cat.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Valor (R$)</label>
              <input
                required type="number" step="0.01" placeholder="0,00"
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 border border-transparent focus:border-red-200 outline-none font-bold text-gray-700"
                value={formDespesa.valor}
                onChange={e => setFormDespesa({...formDespesa, valor: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Vencimento</label>
              <input
                required type="date"
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 border border-transparent focus:border-red-200 outline-none font-bold text-gray-500"
                value={formDespesa.data_vencimento}
                onChange={e => setFormDespesa({...formDespesa, data_vencimento: e.target.value})}
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Status Inicial</label>
              <select
                className="w-full p-4 bg-gray-50 rounded-2xl mt-1 border border-transparent focus:border-red-200 outline-none font-bold text-gray-600 cursor-pointer"
                value={formDespesa.status}
                onChange={e => setFormDespesa({...formDespesa, status: e.target.value})}
              >
                {STATUS_DESPESA.map(s => <option key={s.valor} value={s.valor}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer bg-gray-50 p-4 rounded-2xl mt-2 border border-transparent hover:border-red-100 transition-colors">
            <input
              type="checkbox"
              className="w-5 h-5 rounded accent-iluminus-terracota cursor-pointer"
              checked={formDespesa.recorrente}
              onChange={e => setFormDespesa({...formDespesa, recorrente: e.target.checked})}
            />
            <span className="text-sm font-bold text-gray-700">Despesa Recorrente (Mensal)</span>
          </label>

          <div>
            <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Observações (opcional)</label>
            <textarea
              rows={2}
              placeholder="Detalhes adicionais ou link do boleto..."
              className="w-full p-4 bg-gray-50 rounded-2xl mt-1 border border-transparent focus:border-red-200 outline-none resize-none font-medium text-gray-600"
              value={formDespesa.observacoes}
              onChange={e => setFormDespesa({...formDespesa, observacoes: e.target.value})}
            />
          </div>

          <button 
            type="submit" 
            disabled={salvando} 
            className="w-full bg-red-500 text-white py-4 rounded-2xl font-black shadow-lg shadow-red-200 hover:scale-[1.01] flex items-center justify-center gap-2 mt-4 transition-all"
          >
            {salvando ? <RefreshCw className="animate-spin" size={20} /> : null}
            {salvando ? "Salvando..." : (formDespesa.id ? "Salvar Alterações" : "Adicionar Despesa")}
          </button>
        </form>
      </Modal>

      <ModalConfirmacao 
        isOpen={modalExcluir.isOpen}
        onClose={modalExcluir.fechar}
        onConfirm={excluirDespesa}
        titulo="Excluir Despesa?"
        mensagem={`Tem certeza que deseja apagar a despesa "${despesaExcluir?.descricao}"? Esta ação não pode ser desfeita.`}
        tipo="danger"
      />
    </div>
  );
}