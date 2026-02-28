import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Plus, Trash2, Edit2, DollarSign, Calendar, 
  TrendingDown, AlertCircle, Filter, Download,
  Zap, Droplet, Wifi, Users, Wrench, ShoppingCart,
  Home, CreditCard, FileText
} from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import { ModalConfirmacao, useModal } from '../components/shared/Modal';
import Modal from '../components/shared/Modal';
import { TableSkeleton, CardSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import { formatarMoeda, formatarData, paraUTC } from '../lib/utils';

// Categorias de despesas
const CATEGORIAS_DESPESA = [
  { valor: 'energia', label: 'Energia Elétrica', icone: <Zap size={16} /> },
  { valor: 'agua', label: 'Água', icone: <Droplet size={16} /> },
  { valor: 'internet', label: 'Internet', icone: <Wifi size={16} /> },
  { valor: 'salarios', label: 'Salários', icone: <Users size={16} /> },
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
      const inicioMes = paraUTC(filtros.ano, filtros.mes, 1);
      const fimMes = paraUTC(filtros.ano, filtros.mes + 1, 0);

      const { data, error } = await supabase
        .from('despesas')
        .select('*')
        .gte('data_vencimento', inicioMes)
        .lte('data_vencimento', fimMes)
        .order('data_vencimento', { ascending: false });

      if (error) throw error;

      // Atualizar status de despesas atrasadas
      const hoje = new Date();
      const despesasAtualizadas = data.map(d => {
        if (d.status === 'pendente' && new Date(d.data_vencimento) < hoje) {
          return { ...d, status: 'atrasado' };
        }
        return d;
      });

      setDespesas(despesasAtualizadas);
      calcularMetricas(despesasAtualizadas);

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

    // Agregar por categoria
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
    
    try {
      const despesaData = {
        ...formDespesa,
        valor: Number(formDespesa.valor)
      };

      if (despesaEditando) {
        // Atualizar
        const { error } = await supabase
          .from('despesas')
          .update(despesaData)
          .eq('id', despesaEditando.id);
        
        if (error) throw error;
        showToast.success("Despesa atualizada!");
      } else {
        // Criar nova
        const { error } = await supabase
          .from('despesas')
          .insert([despesaData]);
        
        if (error) throw error;
        showToast.success("Despesa cadastrada!");
      }

      modalNova.fechar();
      resetForm();
      fetchDespesas();
    } catch (err) {
      showToast.error("Erro ao salvar despesa.");
    }
  }

  async function excluirDespesa() {
    try {
      const { error } = await supabase
        .from('despesas')
        .delete()
        .eq('id', despesaExcluir.id);
      
      if (error) throw error;

      showToast.success("Despesa excluída!");
      modalExcluir.fechar();
      setDespesaExcluir(null);
      fetchDespesas();
    } catch (err) {
      showToast.error("Erro ao excluir despesa.");
    }
  }

  async function marcarComoPago(despesa) {
    try {
      const { error } = await supabase
        .from('despesas')
        .update({ 
          status: 'pago',
          data_pagamento: new Date().toISOString()
        })
        .eq('id', despesa.id);
      
      if (error) throw error;

      showToast.success("Despesa marcada como paga!");
      fetchDespesas();
    } catch (err) {
      showToast.error("Erro ao atualizar status.");
    }
  }

  function abrirEdicao(despesa) {
    setDespesaEditando(despesa);
    setFormDespesa({
      descricao: despesa.descricao,
      categoria: despesa.categoria,
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
    const dadosExport = despesasFiltradas.map(d => ({
      'Descrição': d.descricao,
      'Categoria': CATEGORIAS_DESPESA.find(c => c.valor === d.categoria)?.label,
      'Valor': d.valor,
      'Vencimento': formatarData(d.data_vencimento),
      'Status': d.status,
      'Data Pagamento': d.data_pagamento ? formatarData(d.data_pagamento) : '',
      'Recorrente': d.recorrente ? 'Sim' : 'Não',
      'Observações': d.observacoes || ''
    }));

    const headers = Object.keys(dadosExport[0]);
    const csvRows = [
      headers.join(','),
      ...dadosExport.map(row => 
        headers.map(header => {
          const value = row[header];
          return typeof value === 'string' && value.includes(',') 
            ? `"${value}"` 
            : value;
        }).join(',')
      )
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `despesas_${filtros.mes + 1}_${filtros.ano}.csv`);
    link.click();
    showToast.success("Relatório exportado!");
  }

  // Aplicar filtros
  const despesasFiltradas = despesas.filter(d => {
    const matchCategoria = filtros.categoria === 'todas' || d.categoria === filtros.categoria;
    const matchStatus = filtros.status === 'todos' || d.status === filtros.status;
    return matchCategoria && matchStatus;
  });

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Despesas</h1>
          <p className="text-gray-500">Controle de custos operacionais</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={exportarRelatorio}
            className="flex items-center gap-2 bg-white border border-gray-200 px-5 py-3 rounded-2xl font-bold text-gray-600 hover:bg-gray-50 transition-all"
          >
            <Download size={18} /> Exportar
          </button>
          <button 
            onClick={() => {
              resetForm();
              modalNova.abrir();
            }}
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
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">
              Total Gasto no Mês
            </p>
            <h2 className="text-3xl font-black text-gray-800">
              {formatarMoeda(metricas.totalMes)}
            </h2>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
            <div className="bg-orange-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-orange-600">
              <AlertCircle />
            </div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">
              Pendentes
            </p>
            <h2 className="text-3xl font-black text-gray-800">
              {formatarMoeda(metricas.pendentes)}
            </h2>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
            <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-blue-600">
              <FileText />
            </div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">
              Total de Despesas
            </p>
            <h2 className="text-3xl font-black text-gray-800">
              {despesas.length}
            </h2>
          </div>
        </div>
      )}

      {/* Distribuição por Categoria */}
      {metricas.porCategoria.length > 0 && (
        <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-6">Gastos por Categoria</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {metricas.porCategoria.map((cat, idx) => (
              <div key={idx} className="bg-gray-50 p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-gray-600">
                  {cat.icone}
                  <span className="text-xs font-bold">{cat.categoria}</span>
                </div>
                <p className="text-xl font-black text-gray-800">
                  {formatarMoeda(cat.valor)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white p-6 rounded-[28px] border border-gray-100 shadow-sm">
        <div className="flex flex-wrap gap-4">
          {/* Mês */}
          <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-gray-200"
            value={filtros.mes}
            onChange={(e) => setFiltros({...filtros, mes: Number(e.target.value)})}
          >
            {Array.from({length: 12}, (_, i) => (
              <option key={i} value={i}>
                {new Date(2024, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}
              </option>
            ))}
          </select>

          {/* Ano */}
          <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-gray-200"
            value={filtros.ano}
            onChange={(e) => setFiltros({...filtros, ano: Number(e.target.value)})}
          >
            {Array.from({length: 5}, (_, i) => {
              const ano = new Date().getFullYear() - 2 + i;
              return <option key={ano} value={ano}>{ano}</option>;
            })}
          </select>

          {/* Categoria */}
          <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-gray-200"
            value={filtros.categoria}
            onChange={(e) => setFiltros({...filtros, categoria: e.target.value})}
          >
            <option value="todas">Todas Categorias</option>
            {CATEGORIAS_DESPESA.map(cat => (
              <option key={cat.valor} value={cat.valor}>{cat.label}</option>
            ))}
          </select>

          {/* Status */}
          <select 
            className="bg-gray-50 px-4 py-3 rounded-2xl text-sm font-bold border border-gray-200"
            value={filtros.status}
            onChange={(e) => setFiltros({...filtros, status: e.target.value})}
          >
            <option value="todos">Todos Status</option>
            {STATUS_DESPESA.map(s => (
              <option key={s.valor} value={s.valor}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabela de Despesas */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        {loading ? <TableSkeleton /> : despesasFiltradas.length === 0 ? (
          <EmptyState 
            titulo="Nenhuma despesa encontrada"
            mensagem="Adicione uma nova despesa ou ajuste os filtros."
          />
        ) : (
          <table className="w-full text-left">
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
                const categoria = CATEGORIAS_DESPESA.find(c => c.valor === d.categoria);
                const statusCor = STATUS_DESPESA.find(s => s.valor === d.status);

                return (
                  <tr key={d.id} className="hover:bg-gray-50/30 transition-colors group">
                    <td className="px-8 py-5">
                      <div>
                        <p className="font-bold text-gray-700">{d.descricao}</p>
                        {d.recorrente && (
                          <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-black uppercase">
                            Recorrente
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2 text-gray-600">
                        {categoria?.icone}
                        <span className="text-sm font-medium">{categoria?.label}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-sm text-gray-600">
                      {formatarData(d.data_vencimento)}
                    </td>
                    <td className="px-8 py-5 font-bold text-gray-800">
                      {formatarMoeda(d.valor)}
                    </td>
                    <td className="px-8 py-5">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                        statusCor?.cor === 'green' ? 'bg-green-100 text-green-600' :
                        statusCor?.cor === 'yellow' ? 'bg-yellow-100 text-yellow-600' :
                        'bg-red-100 text-red-600'
                      }`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex gap-2 justify-end">
                        {d.status !== 'pago' && (
                          <button 
                            onClick={() => marcarComoPago(d)}
                            className="bg-green-500 text-white px-4 py-2 rounded-xl font-bold text-xs hover:brightness-95 transition-all shadow-sm"
                          >
                            Pagar
                          </button>
                        )}
                        <button 
                          onClick={() => abrirEdicao(d)}
                          className="bg-white border border-gray-100 p-2 rounded-xl text-gray-600 hover:bg-gray-50 transition-all"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          onClick={() => {
                            setDespesaExcluir(d);
                            modalExcluir.abrir();
                          }}
                          className="bg-white border border-gray-100 p-2 rounded-xl text-red-500 hover:bg-red-50 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Nova/Editar Despesa */}
      <Modal
        isOpen={modalNova.isOpen}
        onClose={() => {
          modalNova.fechar();
          resetForm();
        }}
        titulo={despesaEditando ? "Editar Despesa" : "Nova Despesa"}
      >
        <form onSubmit={salvarDespesa} className="space-y-6 pt-2">
          <div>
            <label className="block text-xs font-black text-gray-400 uppercase mb-2">
              Descrição
            </label>
            <input
              required
              placeholder="Ex: Conta de luz - Janeiro"
              className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none"
              value={formDespesa.descricao}
              onChange={e => setFormDespesa({...formDespesa, descricao: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase mb-2">
                Categoria
              </label>
              <select
                required
                className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none"
                value={formDespesa.categoria}
                onChange={e => setFormDespesa({...formDespesa, categoria: e.target.value})}
              >
                {CATEGORIAS_DESPESA.map(cat => (
                  <option key={cat.valor} value={cat.valor}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 uppercase mb-2">
                Valor (R$)
              </label>
              <input
                required
                type="number"
                step="0.01"
                placeholder="0,00"
                className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none"
                value={formDespesa.valor}
                onChange={e => setFormDespesa({...formDespesa, valor: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase mb-2">
                Vencimento
              </label>
              <input
                required
                type="date"
                className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none"
                value={formDespesa.data_vencimento}
                onChange={e => setFormDespesa({...formDespesa, data_vencimento: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 uppercase mb-2">
                Status
              </label>
              <select
                className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none"
                value={formDespesa.status}
                onChange={e => setFormDespesa({...formDespesa, status: e.target.value})}
              >
                {STATUS_DESPESA.map(s => (
                  <option key={s.valor} value={s.valor}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 rounded accent-iluminus-terracota"
                checked={formDespesa.recorrente}
                onChange={e => setFormDespesa({...formDespesa, recorrente: e.target.checked})}
              />
              <span className="text-sm font-bold text-gray-700">Despesa Recorrente (mensal)</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-black text-gray-400 uppercase mb-2">
              Observações (opcional)
            </label>
            <textarea
              rows={3}
              placeholder="Detalhes adicionais..."
              className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none resize-none"
              value={formDespesa.observacoes}
              onChange={e => setFormDespesa({...formDespesa, observacoes: e.target.value})}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                modalNova.fechar();
                resetForm();
              }}
              className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-2xl font-black"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-iluminus-terracota text-white py-4 rounded-2xl font-black shadow-lg shadow-orange-100"
            >
              {despesaEditando ? 'Atualizar' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Excluir */}
      <ModalConfirmacao
        isOpen={modalExcluir.isOpen}
        onClose={modalExcluir.fechar}
        onConfirm={excluirDespesa}
        titulo="Excluir Despesa?"
        mensagem={`Tem certeza que deseja excluir "${despesaExcluir?.descricao}"? Esta ação não pode ser desfeita.`}
        tipo="danger"
      />
    </div>
  );
}
