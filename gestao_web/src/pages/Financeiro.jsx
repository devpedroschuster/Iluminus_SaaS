import React, { useState, useMemo, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, CreditCard, Smartphone, 
  Banknote, Clock, CheckCircle, Search, RefreshCw, AlertCircle, Calendar, FileSpreadsheet, Plus,
  Pencil, Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

import { financeiroService } from '../services/financeiroService';
import { useFinanceiro } from '../hooks/useFinanceiro';

import SelectFormaPagamento from '../components/SelectFormaPagamento';
import RepasseAlunoCard from '../components/RepasseAlunoCard';
import { TIPOS_AULA } from '../lib/constants';

import { showToast } from '../components/shared/Toast';
import Modal, { useModal, ModalConfirmacao } from '../components/ui/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import ModalAdicionarPagamentoManual from '../components/ModalAdicionarPagamentoManual';
import { formatarMoeda } from '../lib/utils';

import Surface from '../components/ui/Surface';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Deriva o status real de exibição a partir de `item.status` + `item.data_vencimento`.
 * O BD só armazena 'pago' | 'pendente', mas "atrasado" é calculado no front-end.
 *
 * @returns {{ tipo: 'pago'|'pendente'|'atrasado', diasAtraso: number }}
 */
function calcularStatusReal(item) {
  if (item.status === 'pago') return { tipo: 'pago', diasAtraso: 0 };

  // Usa data local (não UTC) para evitar que pagamentos do dia apareçam como atrasados
  // em fusos como o do Brasil, onde o UTC já virou para o dia seguinte à noite.
  const d = new Date();
  const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (item.data_vencimento < hoje) {
    const venc = new Date(item.data_vencimento + 'T12:00:00');
    const diasAtraso = Math.max(1, Math.floor((Date.now() - venc.getTime()) / 86_400_000));
    return { tipo: 'atrasado', diasAtraso };
  }

  return { tipo: 'pendente', diasAtraso: 0 };
}

const ORDEM_STATUS = { atrasado: 0, pendente: 1, pago: 2 };

// ──────────────────────────────────────────────────────────────────────────────

export default function Financeiro() {
  const dataAtual = new Date();
  const [filtros, setFiltros] = useState({
    mes: dataAtual.getMonth() + 1,
    ano: dataAtual.getFullYear()
  });

  const { mensalidades, loading, refetch } = useFinanceiro(filtros);
  const [busca, setBusca] = useState('');
  
  const modalPagamento = useModal();
  const modalResultado = useModal();
  const modalGerarMensalidades = useModal();
  const [modalAddOpen, setModalAddOpen] = useState(false);

  const modalEditar = useModal();
  const modalExcluir = useModal();
  const [lancamentoEditando, setLancamentoEditando] = useState(null);
  const [lancamentoExcluindo, setLancamentoExcluindo] = useState(null);
  const [formEdicao, setFormEdicao] = useState({});
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const [pagamentoSelecionado, setPagamentoSelecionado] = useState(null);
  const [valorPago, setValorPago] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('');
  const [tipoAula, setTipoAula] = useState('regular');
  const [professorId, setProfessorId] = useState('');
  const [modalidadeNome, setModalidadeNome] = useState('');
  
  const [professores, setProfessores] = useState([]);
  const [resultadoRepasse, setResultadoRepasse] = useState(null);
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    async function carregarProfessores() {
      const { data } = await supabase.from('professores').select('id, nome').eq('ativo', true);
      if (data) setProfessores(data);
    }
    carregarProfessores();
  }, []);

  const metricas = useMemo(() => {
    if (!mensalidades) return { recebido: 0, pendente: 0, atrasado: 0, total: 0 };
    // Usa data local (não UTC) — mesma lógica de calcularStatusReal
    const _d = new Date();
    const hoje = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;

    
    return mensalidades.reduce((acc, m) => {
      const valorOriginal = Number(m.planos?.preco) || 0;
      const valorReal = m.valor_pago !== null ? Number(m.valor_pago) : valorOriginal;
      
      if (m.status === 'pago') {
        acc.recebido += valorReal;
        acc.total += valorReal;
      } else if (m.data_vencimento < hoje) {
        acc.atrasado += valorOriginal;
        acc.total += valorOriginal;
      } else {
        acc.pendente += valorOriginal;
        acc.total += valorOriginal;
      }
      return acc;
    }, { recebido: 0, pendente: 0, atrasado: 0, total: 0 });
  }, [mensalidades]);

  const handleAbrirPagamento = (mensalidade) => {
    setPagamentoSelecionado(mensalidade);
    setValorPago(mensalidade.planos?.preco?.toString() || '');
    setFormaPagamento('');
    setTipoAula('regular');
    setProfessorId('');
    setModalidadeNome('');
    modalPagamento.abrir();
  };

  const handleConfirmarPagamento = async (e) => {
    e.preventDefault();
    try {
      const valorFormatado = parseFloat(valorPago.replace(/\./g, '').replace(',', '.'));
      const payload = {
        valor_pago: valorFormatado,
        forma_pagamento: formaPagamento,
        tipo_aula: tipoAula,
        professor_id: (tipoAula === 'experimental' || tipoAula === 'avulsa') ? professorId : null,
        modalidade_nome: (tipoAula === 'experimental' || tipoAula === 'avulsa') ? modalidadeNome : null
      };

      const res = await financeiroService.confirmarPagamento(pagamentoSelecionado.id, payload);
      showToast.success('Pagamento processado com sucesso!');
      refetch();
      modalPagamento.fechar();
      setResultadoRepasse(res.resultado);
      modalResultado.abrir();
    } catch (error) {
      showToast.error("Erro ao processar pagamento");
    }
  };

  const handleGerarMensalidades = async () => {
    setGerando(true);
    try {
      await financeiroService.gerarMensalidades(filtros.mes, filtros.ano);
      showToast.success('Cobranças geradas para os alunos ativos!');
      refetch();
      modalGerarMensalidades.fechar();
    } catch (error) {
      showToast.error('Erro ao gerar cobranças');
    } finally {
      setGerando(false);
    }
  };

  const handleAbrirEdicao = (item) => {
    setLancamentoEditando(item);
    setFormEdicao({
      valor_pago: item.valor_pago !== null ? item.valor_pago : (item.planos?.preco || ''),
      forma_pagamento: item.forma_pagamento || '',
      data_vencimento: item.data_vencimento || '',
      status: item.status || 'pendente',
    });
    modalEditar.abrir();
  };

  const handleSalvarEdicao = async (e) => {
    e.preventDefault();
    setSalvandoEdicao(true);
    try {
      const payload = {
        data_vencimento: formEdicao.data_vencimento,
        status: formEdicao.status,
        forma_pagamento: formEdicao.forma_pagamento || null,
        valor_pago: formEdicao.valor_pago !== '' ? parseFloat(String(formEdicao.valor_pago).replace(/\./g, '').replace(',', '.')) : null,
      };
      // Se voltando para pendente, limpa dados de pagamento
      if (formEdicao.status === 'pendente') {
        payload.valor_pago = null;
        payload.forma_pagamento = null;
        payload.data_pagamento = null;
      }
      const { error } = await supabase
        .from('mensalidades')
        .update(payload)
        .eq('id', lancamentoEditando.id);
      if (error) throw error;
      showToast.success('Lançamento atualizado com sucesso!');
      refetch();
      modalEditar.fechar();
    } catch (error) {
      showToast.error('Erro ao atualizar lançamento');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const handleAbrirExclusao = (item) => {
    setLancamentoExcluindo(item);
    modalExcluir.abrir();
  };

  const handleConfirmarExclusao = async () => {
    setExcluindo(true);
    try {
      // Remove repasses vinculados primeiro
      await supabase.from('repasses').delete().eq('mensalidade_id', lancamentoExcluindo.id);
      const { error } = await supabase
        .from('mensalidades')
        .delete()
        .eq('id', lancamentoExcluindo.id);
      if (error) throw error;
      showToast.success('Lançamento excluído com sucesso!');
      refetch();
      modalExcluir.fechar();
    } catch (error) {
      showToast.error('Erro ao excluir lançamento');
    } finally {
      setExcluindo(false);
    }
  };

  const [filtroStatus, setFiltroStatus] = useState('todos'); // 'todos' | 'atrasado' | 'pendente' | 'pago'

  const alunosFiltrados = useMemo(() => {
    if (!mensalidades) return [];

    let lista = mensalidades.filter(m => {
      const nomeBase = m.alunos?.nome_completo || m.nome_visitante || '';
      if (!nomeBase.toLowerCase().includes(busca.toLowerCase())) return false;
      if (filtroStatus === 'todos') return true;
      return calcularStatusReal(m).tipo === filtroStatus;
    });

    // Atrasados primeiro (mais antigos no topo), depois pendentes, depois pagos
    lista.sort((a, b) => {
      const sa = calcularStatusReal(a);
      const sb = calcularStatusReal(b);
      const diff = ORDEM_STATUS[sa.tipo] - ORDEM_STATUS[sb.tipo];
      if (diff !== 0) return diff;
      if (sa.tipo === 'atrasado') return sb.diasAtraso - sa.diasAtraso;
      return 0;
    });

    return lista;
  }, [mensalidades, busca, filtroStatus]);

  return (
    <div className="p-8 space-y-8 animate-in fade-in max-w-7xl mx-auto">
      {/* Header com Ações */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <DollarSign className="text-primary" size={32} /> Financeiro
          </h1>
          <p className="text-muted-foreground mt-1">Gestão de mensalidades e repasses profissionais.</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button
            variant="secondary"
            onClick={modalGerarMensalidades.abrir}
            leftIcon={<RefreshCw size={18} />}
            className="flex-1 md:flex-none"
          >
            Gerar Cobranças
          </Button>
          <Button
            variant="success"
            onClick={() => setModalAddOpen(true)}
            leftIcon={<Plus size={18} />}
          >
            Novo Lançamento
          </Button>
        </div>
      </div>

      {/* Cartões Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <CardMetrica titulo="Recebido"  valor={metricas.recebido}  icone={<CheckCircle />} tone="success"     />
        <CardMetrica titulo="Pendente"  valor={metricas.pendente}  icone={<Clock />}        tone="warning"     />
        <CardMetrica titulo="Atrasado"  valor={metricas.atrasado}  icone={<AlertCircle />}  tone="destructive" />
        <CardMetrica titulo="Total Mês" valor={metricas.total}     icone={<TrendingUp />}   tone="info"        />
      </div>

      {/* Filtros e Busca */}
      <Surface variant="card" className="flex flex-col md:flex-row gap-4">
        <div className="flex gap-2">
          {/* Mês */}
          <Input
            as="select"
            value={filtros.mes}
            onChange={(e) => setFiltros({ ...filtros, mes: parseInt(e.target.value) })}
            className="font-bold"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(0, i).toLocaleString('pt-BR', { month: 'long' })}
              </option>
            ))}
          </Input>

          {/* Ano */}
          <Input
            as="select"
            value={filtros.ano}
            onChange={(e) => setFiltros({ ...filtros, ano: parseInt(e.target.value) })}
            className="font-bold"
          >
            {[2024, 2025, 2026].map(ano => (
              <option key={ano} value={ano}>{ano}</option>
            ))}
          </Input>
        </div>

        {/* Busca */}
        <Input
          leftIcon={<Search size={18} />}
          type="text"
          placeholder="Buscar aluno..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          wrapperClassName="flex-1"
        />

        {/* Filtro rápido de status */}
        <div className="flex gap-1.5 shrink-0">
          {[
            { valor: 'todos',    label: 'Todos',    tone: 'neutral'      },
            { valor: 'atrasado', label: 'Atrasados', tone: 'destructive' },
            { valor: 'pendente', label: 'Pendentes', tone: 'warning'     },
            { valor: 'pago',     label: 'Pagos',    tone: 'success'      },
          ].map(({ valor, label, tone }) => (
            <button
              key={valor}
              onClick={() => setFiltroStatus(valor)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                filtroStatus === valor
                  ? tone === 'destructive' ? 'bg-destructive text-destructive-foreground border-destructive'
                  : tone === 'warning'     ? 'bg-warning text-warning-foreground border-warning'
                  : tone === 'success'     ? 'bg-success text-success-foreground border-success'
                  : 'bg-foreground text-background border-foreground'
                  : 'bg-card text-muted-foreground border-border hover:border-foreground/30'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Surface>

      {/* Tabela Mensalidades */}
      {loading ? (
        <TableSkeleton />
      ) : alunosFiltrados?.length > 0 ? (
        <Surface variant="card" padding="none" className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs">Aluno</th>
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs">Vencimento</th>
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs">Valor</th>
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs">Pagamento</th>
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs">Status</th>
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {alunosFiltrados.map((item) => {
                const { tipo: statusReal, diasAtraso } = calcularStatusReal(item);
                return (
                <tr
                  key={item.id}
                  className={`hover:bg-primary-soft/20 transition-colors ${
                    statusReal === 'atrasado' ? 'bg-destructive-soft/20' : ''
                  }`}
                >
                  <td className="p-4 font-bold text-foreground flex items-center gap-2">
                    {item.alunos?.nome_completo || item.nome_visitante || 'Visitante'}
                    {!item.alunos && item.nome_visitante && (
                      <Badge tone="neutral" variant="soft" className="text-[9px]">Avulso</Badge>
                    )}
                  </td>
                  <td className="p-4 font-medium">
                    <span className={statusReal === 'atrasado' ? 'text-destructive font-bold' : 'text-muted-foreground'}>
                      {new Date(item.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </span>
                    {statusReal === 'atrasado' && (
                      <p className="text-[10px] text-destructive font-bold mt-0.5">
                        há {diasAtraso} {diasAtraso === 1 ? 'dia' : 'dias'}
                      </p>
                    )}
                  </td>
                  <td className="p-4 font-bold text-foreground">
                    {item.status === 'pago'
                      ? formatarMoeda(item.valor_pago !== null ? item.valor_pago : item.planos?.preco)
                      : formatarMoeda(item.planos?.preco)}
                  </td>
                  <td className="p-4">
                    {item.status === 'pago' && item.forma_pagamento ? (
                      <Badge tone="neutral" variant="soft" className="capitalize">
                        {item.forma_pagamento}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-4">
                    <Badge
                      tone={
                        statusReal === 'pago'     ? 'success'     :
                        statusReal === 'atrasado' ? 'destructive' : 'warning'
                      }
                    >
                      {statusReal === 'atrasado' ? 'ATRASADO'
                        : statusReal === 'pago'  ? 'PAGO'
                        : 'PENDENTE'}
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {item.status !== 'pago' && (
                        <Button
                          variant="brand"
                          size="sm"
                          onClick={() => handleAbrirPagamento(item)}
                        >
                          Receber
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAbrirEdicao(item)}
                        title="Editar lançamento"
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAbrirExclusao(item)}
                        title="Excluir lançamento"
                        className="text-destructive hover:text-destructive hover:bg-destructive-soft"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </Surface>
      ) : (
        <EmptyState titulo="Nenhum registro" mensagem="Não há mensalidades para o período selecionado." />
      )}

      {/* Modal Pagamento */}
      <Modal isOpen={modalPagamento.isOpen} onClose={modalPagamento.fechar} titulo="Confirmar Recebimento">
        {pagamentoSelecionado && (
          <form onSubmit={handleConfirmarPagamento} className="space-y-6">
            {/* Info do aluno */}
            <Surface variant="muted" padding="md">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Aluno</p>
              <p className="font-black text-foreground text-lg mt-0.5">
                {pagamentoSelecionado.alunos?.nome_completo || pagamentoSelecionado.nome_visitante || 'Visitante'}
              </p>
            </Surface>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Valor (R$)
                </label>
                <Input
                  type="text"
                  value={valorPago}
                  onChange={(e) => setValorPago(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Forma
                </label>
                <SelectFormaPagamento value={formaPagamento} onChange={setFormaPagamento} required />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                Tipo de Aula
              </label>
              <Input
                as="select"
                value={tipoAula}
                onChange={(e) => setTipoAula(e.target.value)}
              >
                {TIPOS_AULA.map(t => (
                  <option key={t.valor} value={t.valor}>{t.label}</option>
                ))}
              </Input>
            </div>

            {(tipoAula === 'experimental' || tipoAula === 'avulsa') && (
              <Surface variant="muted" padding="md" className="grid grid-cols-2 gap-4">
                <Input
                  as="select"
                  value={professorId}
                  onChange={(e) => setProfessorId(e.target.value)}
                  required
                >
                  <option value="">Professor...</option>
                  {professores.map(p => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </Input>
                <Input
                  type="text"
                  value={modalidadeNome}
                  onChange={(e) => setModalidadeNome(e.target.value)}
                  placeholder="Modalidade..."
                  required
                />
              </Surface>
            )}

            <Button type="submit" variant="brand" size="lg" fullWidth>
              Confirmar Recebimento
            </Button>
          </form>
        )}
      </Modal>

      {/* Modal Sucesso e Repasse */}
      <Modal isOpen={modalResultado.isOpen} onClose={modalResultado.fechar} titulo="Repasse Processado">
        {resultadoRepasse && pagamentoSelecionado && (
          <div className="space-y-6">
            <RepasseAlunoCard
              aluno={pagamentoSelecionado.alunos || { nome_completo: pagamentoSelecionado.nome_visitante || 'Visitante' }}
              mensalidade={{ tipo_aula: tipoAula }}
              resultado={resultadoRepasse}
            />
            <Button variant="secondary" fullWidth onClick={modalResultado.fechar}>
              Fechar
            </Button>
          </div>
        )}
      </Modal>

      <ModalConfirmacao 
        isOpen={modalGerarMensalidades.isOpen}
        onClose={modalGerarMensalidades.fechar}
        onConfirm={handleGerarMensalidades}
        titulo="Gerar Cobranças"
        mensagem="Deseja gerar as cobranças para todos os alunos ativos deste mês?"
      />

      <ModalAdicionarPagamentoManual 
        isOpen={modalAddOpen} 
        onClose={() => setModalAddOpen(false)}
        onSucesso={refetch} 
      />

      {/* Modal Editar Lançamento */}
      <Modal isOpen={modalEditar.isOpen} onClose={modalEditar.fechar} titulo="Editar Lançamento">
        {lancamentoEditando && (
          <form onSubmit={handleSalvarEdicao} className="space-y-5">
            <Surface variant="muted" padding="md">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Aluno</p>
              <p className="font-black text-foreground text-lg mt-0.5">
                {lancamentoEditando.alunos?.nome_completo || lancamentoEditando.nome_visitante || 'Visitante'}
              </p>
            </Surface>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Status
                </label>
                <Input
                  as="select"
                  value={formEdicao.status}
                  onChange={(e) => setFormEdicao({ ...formEdicao, status: e.target.value })}
                >
                  <option value="pendente">Pendente</option>
                  <option value="pago">Pago</option>
                </Input>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Vencimento
                </label>
                <Input
                  type="date"
                  value={formEdicao.data_vencimento}
                  onChange={(e) => setFormEdicao({ ...formEdicao, data_vencimento: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Valor Pago (R$)
                </label>
                <Input
                  type="text"
                  value={formEdicao.valor_pago}
                  onChange={(e) => setFormEdicao({ ...formEdicao, valor_pago: e.target.value })}
                  placeholder="0,00"
                  disabled={formEdicao.status === 'pendente'}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Forma de Pagamento
                </label>
                <SelectFormaPagamento
                  value={formEdicao.forma_pagamento}
                  onChange={(v) => setFormEdicao({ ...formEdicao, forma_pagamento: v })}
                  disabled={formEdicao.status === 'pendente'}
                />
              </div>
            </div>

            {formEdicao.status === 'pendente' && (
              <Surface variant="muted" padding="sm">
                <p className="text-xs text-muted-foreground">
                  Ao definir como <strong>Pendente</strong>, os dados de pagamento serão removidos.
                </p>
              </Surface>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" fullWidth onClick={modalEditar.fechar}>
                Cancelar
              </Button>
              <Button type="submit" variant="brand" fullWidth disabled={salvandoEdicao}>
                {salvandoEdicao ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal Confirmar Exclusão */}
      <ModalConfirmacao
        isOpen={modalExcluir.isOpen}
        onClose={modalExcluir.fechar}
        onConfirm={handleConfirmarExclusao}
        titulo="Excluir Lançamento"
        mensagem={
          lancamentoExcluindo
            ? `Deseja excluir o lançamento de ${lancamentoExcluindo.alunos?.nome_completo || lancamentoExcluindo.nome_visitante || 'Visitante'}? Esta ação também removerá os repasses vinculados e não pode ser desfeita.`
            : 'Deseja excluir este lançamento?'
        }
      />
    </div>
  );
}

const ICON_TONE = {
  success:     'bg-success-soft text-success',
  warning:     'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  info:        'bg-info-soft text-info',
};

const CardMetrica = ({ titulo, valor, icone, tone }) => (
  <Surface variant="card" className="flex items-center gap-4">
    <div className={`p-4 rounded-2xl shrink-0 ${ICON_TONE[tone] ?? ICON_TONE.info}`}>
      {React.cloneElement(icone, { size: 24 })}
    </div>
    <div>
      <p className="text-muted-foreground text-xs font-bold uppercase tracking-wide">{titulo}</p>
      <p className="text-2xl font-black text-foreground">{formatarMoeda(valor)}</p>
    </div>
  </Surface>
);