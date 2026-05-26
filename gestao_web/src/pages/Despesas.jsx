import React, { useEffect, useState } from 'react';
import { 
  Plus, Trash2, Edit2, DollarSign, Calendar, 
  TrendingDown, AlertCircle, Filter, Download,
  Zap, Droplet, Wifi, Users, Wrench, ShoppingCart,
  Home, CreditCard, FileText, RefreshCw, Tag
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { despesasService } from '../services/despesasService';
import { showToast } from '../components/shared/Toast';
import { TableSkeleton, CardSkeleton } from '../components/shared/Loading';
import { formatarMoeda, formatarData } from '../lib/utils';

import Button from '../components/ui/Button';
import Input, { Label } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Surface from '../components/ui/Surface';
import EmptyState from '../components/ui/EmptyState';
import Modal, { useModal, ModalConfirmacao } from '../components/ui/Modal';

const CATEGORIAS_DESPESA = [
  { valor: 'energia',      label: 'Energia Elétrica',    icone: <Zap size={16} /> },
  { valor: 'agua',         label: 'Água',                icone: <Droplet size={16} /> },
  { valor: 'internet',     label: 'Internet',            icone: <Wifi size={16} /> },
  { valor: 'salarios',     label: 'Salários/Comissões',  icone: <Users size={16} /> },
  { valor: 'manutencao',   label: 'Manutenção',          icone: <Wrench size={16} /> },
  { valor: 'equipamentos', label: 'Equipamentos',        icone: <ShoppingCart size={16} /> },
  { valor: 'aluguel',      label: 'Aluguel',             icone: <Home size={16} /> },
  { valor: 'impostos',     label: 'Impostos',            icone: <FileText size={16} /> },
  { valor: 'marketing',    label: 'Marketing',           icone: <TrendingDown size={16} /> },
  { valor: 'outros',       label: 'Outros',              icone: <CreditCard size={16} /> },
];

const STATUS_DESPESA = [
  { valor: 'pago',     label: 'Pago',     tone: 'success' },
  { valor: 'pendente', label: 'Pendente', tone: 'warning' },
  { valor: 'atrasado', label: 'Atrasado', tone: 'destructive' },
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
    mes: new Date().getMonth() + 1,
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

  const modalNova    = useModal();
  const modalExcluir = useModal();

  useEffect(() => {
    fetchDespesas();
  }, [filtros.mes, filtros.ano]);

  async function fetchDespesas() {
    setLoading(true);
    try {
      await despesasService.replicarRecorrentes(filtros.mes, filtros.ano);
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
      return { categoria: cat.label, valor: total, icone: cat.icone };
    }).filter(c => c.valor > 0);

    setMetricas({ totalMes, pendentes, porCategoria });
  }

  async function salvarDespesa(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const despesaData = { ...formDespesa, valor: Number(formDespesa.valor) };
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
      'Data Pagamento': d.data_pagamento ? new Date(d.data_pagamento + 'T12:00:00').toLocaleDateString('pt-BR') : '-',
      'Recorrente': d.recorrente ? 'SIM' : 'NÃO',
      'Observações': d.observacoes || '-'
    }));
    const ws = XLSX.utils.json_to_sheet(dadosExport);
    ws['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Despesas');
    const nomeMes = new Date(0, filtros.mes - 1).toLocaleString('pt-BR', { month: 'long' });
    XLSX.writeFile(wb, `Despesas_${nomeMes}_${filtros.ano}.xlsx`);
    showToast.success("Relatório exportado com sucesso!");
  }

  const despesasFiltradas = despesas.filter(d => {
    const matchCategoria = filtros.categoria === 'todas' || d.categoria === filtros.categoria;
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
          <h1 className="text-3xl font-black text-foreground tracking-tight">Despesas</h1>
          <p className="text-muted-foreground">Controle de custos operacionais do estúdio.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {/* Botão Exportar */}
          <Button
            variant="outline"
            leftIcon={<Download size={18} />}
            onClick={exportarRelatorio}
            disabled={despesasFiltradas.length === 0}
          >
            Exportar Excel
          </Button>

          {/* Botão Nova Despesa */}
          <Button
            variant="brand"
            leftIcon={<Plus size={18} />}
            onClick={() => { resetForm(); modalNova.abrir(); }}
          >
            Nova Despesa
          </Button>
        </div>
      </div>

      {/* Métricas */}
      {loading ? <CardSkeleton /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {/* Card: Total Gasto */}
          <Surface variant="card" padding="lg">
            <div className="bg-destructive-soft w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-destructive">
              <TrendingDown />
            </div>
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-2">Total Gasto (Pago)</p>
            <h2 className="text-3xl font-black text-foreground">{formatarMoeda(metricas.totalMes)}</h2>
          </Surface>

          {/* Card: Pendente / Atrasado */}
          <Surface variant="card" padding="lg">
            <div className="bg-warning-soft w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-warning">
              <AlertCircle />
            </div>
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-2">Pendente / Atrasado</p>
            <h2 className="text-3xl font-black text-foreground">{formatarMoeda(metricas.pendentes)}</h2>
          </Surface>

          {/* Card: Qtd. Lançamentos */}
          <Surface variant="card" padding="lg">
            <div className="bg-info-soft w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-info">
              <FileText />
            </div>
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-2">Qtd. de Lançamentos</p>
            <h2 className="text-3xl font-black text-foreground">{despesas.length}</h2>
          </Surface>
        </div>
      )}

      {/* Distribuição por Categoria */}
      {metricas.porCategoria.length > 0 && (
        <Surface variant="card" padding="xl">
          <h3 className="font-bold text-foreground mb-6">Gastos por Categoria (Pagos)</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {metricas.porCategoria.map((cat, idx) => (
              <Surface key={idx} variant="muted" padding="md" className="rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                  {cat.icone}
                  <span className="text-xs font-bold truncate">{cat.categoria}</span>
                </div>
                <p className="text-xl font-black text-foreground">{formatarMoeda(cat.valor)}</p>
              </Surface>
            ))}
          </div>
        </Surface>
      )}

      {/* Filtros */}
      <Surface variant="card" padding="lg">
        <div className="flex flex-wrap gap-4">
          <div className="flex gap-2">
            <Input
              as="select"
              className="cursor-pointer"
              value={filtros.mes}
              onChange={(e) => setFiltros({ ...filtros, mes: Number(e.target.value) })}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2024, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}
                </option>
              ))}
            </Input>
            <Input
              as="select"
              className="cursor-pointer"
              value={filtros.ano}
              onChange={(e) => setFiltros({ ...filtros, ano: Number(e.target.value) })}
            >
              <option value={2024}>2024</option>
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
            </Input>
          </div>

          <Input
            as="select"
            className="cursor-pointer flex-1 min-w-[150px]"
            value={filtros.categoria}
            onChange={(e) => setFiltros({ ...filtros, categoria: e.target.value })}
          >
            <option value="todas">Todas as Categorias</option>
            {CATEGORIAS_DESPESA.map(cat => (
              <option key={cat.valor} value={cat.valor}>{cat.label}</option>
            ))}
          </Input>

          <Input
            as="select"
            className="cursor-pointer flex-1 min-w-[150px]"
            value={filtros.status}
            onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
          >
            <option value="todos">Todos os Status</option>
            <option value="pago">Apenas Pagos</option>
            <option value="pendente">Pendentes/Atrasados</option>
          </Input>
        </div>
      </Surface>

      {/* Tabela Despesas */}
      <Surface variant="card" padding="none" className="overflow-hidden min-h-[400px]">
        {loading ? (
          <TableSkeleton />
        ) : despesasFiltradas.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 mt-10">
            <EmptyState
              icon={<FileText size={28} />}
              title="Nenhuma despesa encontrada"
              description="Nenhum lançamento corresponde aos filtros selecionados."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-8 py-5">Descrição</th>
                  <th className="px-8 py-5">Categoria</th>
                  <th className="px-8 py-5">Vencimento</th>
                  <th className="px-8 py-5">Valor</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {despesasFiltradas.map(d => {
                  const categoria = CATEGORIAS_DESPESA.find(c => c.valor === d.categoria)
                    || { label: 'Outros', icone: <CreditCard size={16} /> };
                  const statusItem = STATUS_DESPESA.find(s => s.valor === d.status);

                  return (
                    <tr key={d.id} className="hover:bg-muted/40 transition-colors group">
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <p className="font-bold text-foreground">{d.descricao}</p>
                          {d.recorrente && (
                            <Badge tone="info" variant="soft" className="mt-1 w-fit text-[9px]">
                              Recorrente
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {categoria.icone}
                          <span className="text-xs font-bold uppercase">{categoria.label}</span>
                        </div>
                      </td>

                      <td className="px-8 py-5 font-bold text-foreground">
                        {new Date(d.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </td>

                      <td className="px-8 py-5 font-black text-destructive">
                        {formatarMoeda(d.valor)}
                      </td>

                      <td className="px-8 py-5">
                        <Badge tone={statusItem?.tone ?? 'neutral'} variant="soft">
                          {d.status}
                        </Badge>
                      </td>

                      <td className="px-8 py-5 text-right">
                        <div className="flex justify-end gap-2 items-center">
                          {d.status !== 'pago' ? (
                            /* Dar Baixa */
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => marcarComoPago(d)}
                              disabled={processandoAcao}
                            >
                              Dar Baixa
                            </Button>
                          ) : (
                            <span className="text-xs font-bold text-muted-foreground mr-4">
                              Pago em {d.data_pagamento
                                ? new Date(d.data_pagamento + 'T12:00:00').toLocaleDateString('pt-BR')
                                : '-'}
                            </span>
                          )}

                          {/* Editar */}
                          <Button
                            variant="outline"
                            size="icon"
                            title="Editar"
                            onClick={() => abrirEdicao(d)}
                          >
                            <Edit2 size={16} />
                          </Button>

                          {/* Excluir */}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Excluir"
                            className="hover:text-destructive hover:bg-destructive-soft"
                            onClick={() => { setDespesaExcluir(d); modalExcluir.abrir(); }}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      <Modal
        aberto={modalNova.aberto}
        fechar={() => { modalNova.fechar(); resetForm(); }}
        title={despesaEditando ? "Editar Despesa" : "Nova Despesa"}
        size="md"
      >
        <form onSubmit={salvarDespesa} className="space-y-4">

          {/* Descrição */}
          <div>
            <Label required>Descrição</Label>
            <Input
              required
              placeholder="Descrição da conta (ex: Luz, Aluguel)"
              value={formDespesa.descricao}
              onChange={e => setFormDespesa({ ...formDespesa, descricao: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Categoria */}
            <div>
              <Label required>Categoria</Label>
              <Input
                as="select"
                required
                className="cursor-pointer"
                value={formDespesa.categoria}
                onChange={e => setFormDespesa({ ...formDespesa, categoria: e.target.value })}
              >
                {CATEGORIAS_DESPESA.map(cat => (
                  <option key={cat.valor} value={cat.valor}>{cat.label}</option>
                ))}
              </Input>
            </div>

            {/* Valor */}
            <div>
              <Label required>Valor (R$)</Label>
              <Input
                required
                type="number"
                step="0.01"
                placeholder="0,00"
                value={formDespesa.valor}
                onChange={e => setFormDespesa({ ...formDespesa, valor: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Vencimento */}
            <div>
              <Label required>Vencimento</Label>
              <Input
                required
                type="date"
                value={formDespesa.data_vencimento}
                onChange={e => setFormDespesa({ ...formDespesa, data_vencimento: e.target.value })}
              />
            </div>

            {/* Status Inicial */}
            <div>
              <Label>Status Inicial</Label>
              <Input
                as="select"
                className="cursor-pointer"
                value={formDespesa.status}
                onChange={e => setFormDespesa({ ...formDespesa, status: e.target.value })}
              >
                {STATUS_DESPESA.map(s => (
                  <option key={s.valor} value={s.valor}>{s.label}</option>
                ))}
              </Input>
            </div>
          </div>

          {/* Recorrente */}
          <label className="flex items-center gap-3 cursor-pointer bg-muted p-4 rounded-xl border border-border hover:border-ring transition-colors">
            <input
              type="checkbox"
              className="w-5 h-5 rounded accent-primary cursor-pointer"
              checked={formDespesa.recorrente}
              onChange={e => setFormDespesa({ ...formDespesa, recorrente: e.target.checked })}
            />
            <span className="text-sm font-bold text-foreground">Despesa Recorrente (Mensal)</span>
          </label>

          {/* Observações */}
          <div>
            <Label>Observações (opcional)</Label>
            <Input
              as="textarea"
              rows={2}
              placeholder="Detalhes adicionais ou link do boleto..."
              value={formDespesa.observacoes}
              onChange={e => setFormDespesa({ ...formDespesa, observacoes: e.target.value })}
              className="resize-none"
            />
          </div>

          <Modal.Footer>
            <Button
              variant="ghost"
              type="button"
              onClick={() => { modalNova.fechar(); resetForm(); }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              type="submit"
              loading={salvando}
              fullWidth
            >
              {formDespesa.id ? "Salvar Alterações" : "Adicionar Despesa"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Modal Confirmação Exclusão */}
      <ModalConfirmacao
        isOpen={modalExcluir.aberto}
        onClose={modalExcluir.fechar}
        onConfirm={excluirDespesa}
        titulo="Excluir Despesa?"
        mensagem={`Tem certeza que deseja apagar a despesa "${despesaExcluir?.descricao}"? Esta ação não pode ser desfeita.`}
        tipo="danger"
      />
    </div>
  );
}