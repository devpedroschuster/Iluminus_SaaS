import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  CheckCircle, Users, DollarSign, FileSpreadsheet,
  PieChart, Calendar, Wallet, RefreshCw, AlertTriangle,
  ChevronDown, ChevronUp, Hash, LayoutGrid, UserCheck,
  TrendingUp, Filter, ArrowRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { comissoesService } from '../services/comissoesService';
import { gerarRepassesMensais, previewRepassesMensais } from '../services/repasseService';
import {
  useComissoesProfessor,
  useResumoMensal,
  useInvalidarComissoes,
} from '../hooks/useComissoesProfessor';
import { showToast } from '../components/shared/Toast';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal, { ModalConfirmacao, useModal } from '../components/ui/Modal';
import ModalPreviewRepasses from '../components/ModalPreviewRepasses';
import { formatarMoeda } from '../lib/utils';
import Badge from '../components/ui/Badge';

import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';

// ─── constantes ──────────────────────────────────────────────────────────────

const TIPOS_AULA = [
  { value: '', label: 'Todos os tipos' },
  { value: 'regular', label: 'Regular' },
  { value: 'plano_livre', label: 'Plano Livre' },
  { value: 'avulsa', label: 'Avulsa' },
  { value: 'experimental', label: 'Experimental' },
];

const TIPO_LABELS = {
  regular: 'Regular',
  plano_livre: 'Plano Livre',
  avulsa: 'Avulsa',
  experimental: 'Experimental',
};

const TIPO_TONE = {
  regular: 'brand',
  plano_livre: 'info',
  avulsa: 'warning',
  experimental: 'purple',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function mesAnoAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatarData(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('T')[0].split('-');
  return `${dia}/${mes}/${ano}`;
}

// ─── sub-componentes ──────────────────────────────────────────────────────────

function TipoAulaBadge({ tipo }) {
  return (
    <Badge tone={TIPO_TONE[tipo] ?? 'neutral'} variant="soft">
      {TIPO_LABELS[tipo] ?? tipo?.replace('_', ' ') ?? '—'}
    </Badge>
  );
}

// ─── Aba: Detalhe por Professor (UX-02 incluído) ─────────────────────────────

function AbaDetalhe({
  professores,
  filtros,
  setFiltros,
  loading: loadingProfs,
}) {
  const invalidarComissoes = useInvalidarComissoes();
  const modalFechamento = useModal();
  const [fechando, setFechando] = useState(false);

  const {
    data: dados,
    isLoading: loading,
    error: erroDados,
  } = useComissoesProfessor(filtros.professorId, filtros.mesAno);

  useEffect(() => {
    if (erroDados) showToast.error('Erro ao buscar detalhes das comissões');
  }, [erroDados]);

  // UX-02: filtra lançamentos por tipo_aula no client
  const lancamentosFiltrados = useMemo(() => {
    const lista = dados?.lancamentos ?? [];
    if (!filtros.tipoAula) return lista;
    return lista.filter(l => l.tipo_aula === filtros.tipoAula);
  }, [dados?.lancamentos, filtros.tipoAula]);

  // KPIs calculados sobre o subset filtrado
  const kpis = useMemo(() => {
    const total = lancamentosFiltrados.reduce((s, l) => s + Number(l.valor), 0);
    const pagas = lancamentosFiltrados.filter(l => l.status === 'pago').length;
    const pendentes = lancamentosFiltrados.length - pagas;
    return { total, qtd: lancamentosFiltrados.length, pagas, pendentes };
  }, [lancamentosFiltrados]);

  const handleFecharMes = async () => {
    setFechando(true);
    try {
      // Fecha com o total COMPLETO (sem filtro de tipo) — fechamento é do mês inteiro
      await comissoesService.fecharMes(
        filtros.professorId,
        filtros.mesAno,
        dados.resumo.total_comissao,
      );
      showToast.success('Mês fechado e comissões aprovadas com sucesso!');
      modalFechamento.fechar();
      invalidarComissoes(filtros.professorId, filtros.mesAno);
    } catch (error) {
      console.error(error);
      showToast.error('Erro ao fechar o mês');
    } finally {
      setFechando(false);
    }
  };

  // UX-02: exporta somente os lançamentos do filtro ativo
  const exportarExcel = () => {
    if (!lancamentosFiltrados.length) return;
    const tipoLabel = filtros.tipoAula
      ? `_${TIPO_LABELS[filtros.tipoAula] ?? filtros.tipoAula}`
      : '';
    const linhas = lancamentosFiltrados.map(l => ({
      Data: formatarData(l.data_referencia),
      Aluno: l.alunos?.nome_completo || 'Desconhecido',
      'Tipo de Aula': TIPO_LABELS[l.tipo_aula] ?? l.tipo_aula?.toUpperCase() ?? '—',
      Modalidade: l.modalidade || '-',
      'Valor (R$)': Number(l.valor).toFixed(2).replace('.', ','),
      Status: l.status ?? 'pendente',
    }));

    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comissões');
    XLSX.writeFile(
      wb,
      `Comissoes_${filtros.mesAno}_Prof_${filtros.professorId}${tipoLabel}.xlsx`,
    );
  };

  const profSelecionado =
    professores.find(p => p.id === filtros.professorId)?.nome || '';
  const mesFormatado = filtros.mesAno.split('-').reverse().join('/');
  const filtroAtivo = !!filtros.tipoAula;

  return (
    <div className="space-y-6">
      {/* FILTROS */}
      <Surface variant="card" padding="lg">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-2">
              <Users size={16} className="text-primary" /> Professor
            </label>
            <Input
              as="select"
              value={filtros.professorId}
              onChange={e => setFiltros(f => ({ ...f, professorId: e.target.value }))}
            >
              <option value="">Selecione o professor...</option>
              {professores.map(p => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Input>
          </div>

          <div className="w-full md:w-48">
            <label className="block text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-2">
              <Calendar size={16} className="text-primary" /> Mês
            </label>
            <Input
              type="month"
              value={filtros.mesAno}
              onChange={e => setFiltros(f => ({ ...f, mesAno: e.target.value }))}
            />
          </div>

          {/* UX-02: filtro por tipo de aula */}
          <div className="w-full md:w-52">
            <label className="block text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-2">
              <Filter size={16} className="text-primary" /> Tipo de Aula
            </label>
            <div className="relative">
              <Input
                as="select"
                value={filtros.tipoAula}
                onChange={e => setFiltros(f => ({ ...f, tipoAula: e.target.value }))}
                className={filtroAtivo ? 'border-primary ring-1 ring-primary/30' : ''}
              >
                {TIPOS_AULA.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Input>
            </div>
          </div>

          <Button
            variant="outline"
            disabled={!filtros.professorId || loading}
            onClick={() => invalidarComissoes(filtros.professorId, filtros.mesAno)}
            className="w-full md:w-auto h-[46px] px-6 font-black gap-2"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </Button>
        </div>

        {/* UX-02: indicador visual de filtro ativo */}
        {filtroAtivo && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filtrando por:</span>
            <TipoAulaBadge tipo={filtros.tipoAula} />
            <button
              onClick={() => setFiltros(f => ({ ...f, tipoAula: '' }))}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Limpar filtro
            </button>
          </div>
        )}
      </Surface>

      {/* RESULTADOS */}
      {loading ? (
        <TableSkeleton />
      ) : dados ? (
        <div className="space-y-6">
          {dados.fechamento && (
            <Surface
              variant="subtle"
              className="border border-success/20 bg-success-soft p-4 rounded-2xl flex items-center gap-3 text-success"
            >
              <CheckCircle size={24} />
              <div>
                <p className="font-bold">Mês Fechado e Pago</p>
                <p className="text-sm opacity-80">
                  As comissões deste mês já foram aprovadas e não podem ser alteradas.
                </p>
              </div>
            </Surface>
          )}

          {/* KPIs — refletem o filtro ativo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Surface
              variant="card"
              padding="lg"
              className="md:col-span-2 flex flex-col md:flex-row justify-between items-center shadow-lg border-primary/20"
            >
              <div>
                <p className="text-muted-foreground font-bold uppercase text-xs mb-1 flex items-center gap-1.5">
                  {filtroAtivo
                    ? <>Total filtrado <TipoAulaBadge tipo={filtros.tipoAula} /></>
                    : 'Total a Pagar (Líquido)'}
                </p>
                <h2 className="text-4xl font-black text-foreground">
                  {formatarMoeda(kpis.total)}
                </h2>
                {filtroAtivo && dados.resumo.total_comissao !== kpis.total && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Total geral do mês: {formatarMoeda(dados.resumo.total_comissao)}
                  </p>
                )}
              </div>
              <div className="mt-4 md:mt-0 flex gap-3">
                <Button
                  variant="outline"
                  onClick={exportarExcel}
                  disabled={!lancamentosFiltrados.length}
                  className="font-bold flex items-center gap-2"
                >
                  <FileSpreadsheet size={18} />
                  {filtroAtivo ? 'Exportar Filtrado' : 'Exportar'}
                </Button>
                {!dados.fechamento && dados.resumo.total_comissao > 0 && (
                  <Button
                    onClick={modalFechamento.abrir}
                    className="bg-success text-success-foreground hover:bg-success/90 font-bold flex items-center gap-2 shadow-lg shadow-success/20 transition-all border-none"
                  >
                    <CheckCircle size={20} /> Aprovar Fechamento
                  </Button>
                )}
              </div>
            </Surface>

            <Surface variant="card" padding="lg" className="flex flex-col justify-center">
              <p className="text-muted-foreground font-bold uppercase text-xs mb-1 flex items-center gap-2">
                <Hash size={14} className="text-primary" />
                {filtroAtivo ? 'Lançamentos filtrados' : 'Comissões'}
              </p>
              <h2 className="text-4xl font-black text-foreground">{kpis.qtd}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {kpis.pagas} recebida{kpis.pagas === 1 ? '' : 's'} ·{' '}
                {kpis.pendentes} pendente{kpis.pendentes === 1 ? '' : 's'}
              </p>
            </Surface>
          </div>

          {/* TABELA */}
          <Surface variant="card" padding="none" className="overflow-hidden">
            <div className="p-6 border-b border-border flex justify-between items-center bg-muted/30">
              <h3 className="font-black text-foreground text-lg flex items-center gap-2">
                <Wallet className="text-primary" size={20} /> Extrato de Repasses
                {filtroAtivo && (
                  <TipoAulaBadge tipo={filtros.tipoAula} />
                )}
              </h3>
            </div>

            {lancamentosFiltrados.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted border-b border-border">
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Data</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Aluno</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Modalidade</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Repasse (R$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lancamentosFiltrados.map(l => (
                      <tr key={l.id} className="hover:bg-subtle transition-colors">
                        <td className="p-4 text-muted-foreground font-medium">
                          {formatarData(l.data_referencia)}
                        </td>
                        <td className="p-4 font-bold text-foreground">
                          {l.alunos?.nome_completo || 'N/A'}
                        </td>
                        <td className="p-4">
                          <TipoAulaBadge tipo={l.tipo_aula} />
                        </td>
                        <td className="p-4 text-muted-foreground">{l.modalidade || '-'}</td>
                        <td className="p-4 font-black text-success text-right">
                          {formatarMoeda(l.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8">
                <EmptyState
                  titulo={filtroAtivo
                    ? `Nenhum lançamento do tipo "${TIPO_LABELS[filtros.tipoAula] ?? filtros.tipoAula}"`
                    : 'Nenhum Repasse'}
                  mensagem={filtroAtivo
                    ? 'Tente selecionar outro tipo de aula ou remover o filtro.'
                    : 'Não foram encontrados repasses para este professor no período selecionado.'}
                />
              </div>
            )}
          </Surface>
        </div>
      ) : null}

      <ModalConfirmacao
        isOpen={modalFechamento.isOpen}
        onClose={modalFechamento.fechar}
        onConfirm={handleFecharMes}
        titulo={`Aprovar Fechamento — ${mesFormatado}?`}
        mensagem={`Você está prestes a aprovar a comissão de ${profSelecionado} no valor total de ${
          dados ? formatarMoeda(dados.resumo.total_comissao) : ''
        }.`}
        loading={fechando}
      />
    </div>
  );
}

// ─── Aba: Visão Geral (UX-04) ────────────────────────────────────────────────

function AbaVisaoGeral({ mesAno, onSelecionarProfessor }) {
  const { data: resumo, isLoading, error } = useResumoMensal(mesAno);

  if (isLoading) return <TableSkeleton />;

  if (error) {
    return (
      <Surface variant="card" className="flex items-center gap-3 p-5 border border-destructive/30 bg-destructive-soft">
        <AlertTriangle size={20} className="text-destructive shrink-0" />
        <p className="text-sm text-destructive font-bold">Erro ao carregar resumo mensal.</p>
      </Surface>
    );
  }

  if (!resumo || resumo.length === 0) {
    return (
      <EmptyState
        icon={<UserCheck size={28} />}
        title="Nenhum repasse neste mês"
        description="Gere os repasses mensais ou confirme pagamentos individuais para que apareçam aqui."
      />
    );
  }

  const totalGeral = resumo.reduce((s, r) => s + r.total, 0);
  const profsFechados = resumo.filter(r => r.fechamento).length;

  return (
    <div className="space-y-6">
      {/* KPIs do mês */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Surface variant="card" padding="lg" className="flex items-center gap-4">
          <span className="rounded-2xl p-3 text-primary bg-primary-soft"><TrendingUp size={20} /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total do Mês</p>
            <p className="text-2xl font-black text-foreground">{formatarMoeda(totalGeral)}</p>
          </div>
        </Surface>
        <Surface variant="card" padding="lg" className="flex items-center gap-4">
          <span className="rounded-2xl p-3 text-success bg-success-soft"><UserCheck size={20} /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Meses Fechados</p>
            <p className="text-2xl font-black text-foreground">
              {profsFechados} <span className="text-sm font-bold text-muted-foreground">/ {resumo.length}</span>
            </p>
          </div>
        </Surface>
        <Surface variant="card" padding="lg" className="flex items-center gap-4">
          <span className="rounded-2xl p-3 text-warning bg-warning-soft"><Users size={20} /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Professores</p>
            <p className="text-2xl font-black text-foreground">{resumo.length}</p>
          </div>
        </Surface>
      </div>

      {/* Tabela consolidada */}
      <Surface variant="card" padding="none" className="overflow-hidden">
        <div className="p-6 border-b border-border bg-muted/30">
          <h3 className="font-black text-foreground text-lg flex items-center gap-2">
            <LayoutGrid className="text-primary" size={20} /> Consolidado por Professor
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Professor</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Composição</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Lançamentos</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Total</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resumo.map(r => (
                <tr key={r.professor_id} className="hover:bg-subtle transition-colors group">
                  <td className="p-4">
                    <p className="font-bold text-foreground">{r.nome}</p>
                    {r.fechamento && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Fechado em {formatarData(r.fechamento.fechado_em)}
                      </p>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(r.porTipo).map(([tipo, valor]) => (
                        <span
                          key={tipo}
                          title={`${TIPO_LABELS[tipo] ?? tipo}: ${formatarMoeda(valor)}`}
                          className="cursor-help"
                        >
                          <TipoAulaBadge tipo={tipo} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 text-right font-bold text-foreground">{r.qtd}</td>
                  <td className="p-4 text-right font-black text-success">{formatarMoeda(r.total)}</td>
                  <td className="p-4">
                    {r.fechamento ? (
                      <Badge tone="success">Fechado</Badge>
                    ) : (
                      <Badge tone="warning">Pendente</Badge>
                    )}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => onSelecionarProfessor(r.professor_id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                    >
                      Ver detalhe <ArrowRight size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}

// ─── página principal ─────────────────────────────────────────────────────────

export default function Comissoes() {
  const [professores, setProfessores] = useState([]);
  const [filtros, setFiltros] = useState({
    professorId: '',
    mesAno: mesAnoAtual(),
    tipoAula: '', // UX-02
  });
  const [aba, setAba] = useState('geral'); // UX-04: 'geral' | 'detalhe'
  const [gerando, setGerando] = useState(false);
  const [resultadoGeracao, setResultadoGeracao] = useState(null);
  const [resumoExpandido, setResumoExpandido] = useState(false);

  const modalGeracao = useModal();
  const invalidarComissoes = useInvalidarComissoes();

  useEffect(() => {
    async function carregarProfessores() {
      try {
        const profs = await comissoesService.listarProfessores();
        setProfessores(profs || []);
      } catch {
        showToast.error('Erro ao carregar lista de professores');
      }
    }
    carregarProfessores();
  }, []);

  const handleGerarRepasses = async () => {
    const [ano, mes] = filtros.mesAno.split('-').map(Number);
    setGerando(true);
    setResultadoGeracao(null);
    try {
      const resultado = await gerarRepassesMensais(mes, ano);
      if (resultado?.jaGerados) {
        showToast.error(resultado.error || 'Repasses deste mês já foram gerados.');
        modalGeracao.fechar();
        return;
      }
      setResultadoGeracao(resultado);
      showToast.success(`${resultado.gerados} repasse(s) gerado(s) com sucesso!`);
      invalidarComissoes(filtros.professorId, filtros.mesAno);
    } catch (err) {
      const msg = err?.message || 'Erro ao gerar repasses mensais.';
      showToast.error(msg);
      console.error('[Comissoes] gerarRepassesMensais:', err);
    } finally {
      setGerando(false);
      modalGeracao.fechar();
    }
  };

  // UX-04: ao clicar "Ver detalhe" na visão geral, pre-seleciona o professor e muda de aba
  const handleSelecionarProfessor = (professorId) => {
    setFiltros(f => ({ ...f, professorId }));
    setAba('detalhe');
  };

  const mesFormatado = filtros.mesAno.split('-').reverse().join('/');

  return (
    <div className="p-8 space-y-8 animate-in fade-in max-w-7xl mx-auto">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <PieChart className="text-primary" size={32} /> Comissões e Repasses
          </h1>
          <p className="text-muted-foreground mt-1">
            Gere os extratos de pagamento consolidados dos professores.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Seletor de mês no header — afeta ambas as abas */}
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-muted-foreground" />
            <Input
              type="month"
              value={filtros.mesAno}
              onChange={e => setFiltros(f => ({ ...f, mesAno: e.target.value }))}
              className="w-40"
            />
          </div>
          <Button
            variant="brand"
            onClick={modalGeracao.abrir}
            className="flex items-center gap-2 font-black"
          >
            <RefreshCw size={18} />
            Gerar Repasses
          </Button>
        </div>
      </div>

      {/* RESULTADO DA ÚLTIMA GERAÇÃO */}
      {resultadoGeracao?.sucesso && (
        <Surface
          variant="subtle"
          className="border border-success/20 bg-success-soft rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-success">
              <CheckCircle size={22} />
              <div>
                <p className="font-black">
                  {resultadoGeracao.gerados} repasse(s) gerado(s) para {resultadoGeracao.mes}
                </p>
                <p className="text-sm opacity-80">Baseado nos alunos matriculados em cada modalidade.</p>
              </div>
            </div>
            <button
              onClick={() => setResumoExpandido(v => !v)}
              className="text-success/70 hover:text-success transition-colors p-1"
            >
              {resumoExpandido ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>

          {resumoExpandido && resultadoGeracao.resumo?.length > 0 && (
            <div className="border-t border-success/20 pt-3 space-y-1">
              {resultadoGeracao.resumo.map(r => (
                <div key={r.nome} className="flex justify-between text-sm text-success/90">
                  <span className="font-bold">{r.nome}</span>
                  <span>{r.alunos} aluno(s) · {formatarMoeda(r.total)}</span>
                </div>
              ))}
            </div>
          )}

          {resultadoGeracao.avisos?.length > 0 && (
            <div className="border-t border-warning/20 pt-3 space-y-1">
              {resultadoGeracao.avisos.map((av, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{av}</span>
                </div>
              ))}
            </div>
          )}
        </Surface>
      )}

      {/* TABS — UX-04 */}
      <div className="border-b border-border">
        <div className="flex gap-0">
          {[
            { id: 'geral', label: 'Visão Geral', icon: LayoutGrid },
            { id: 'detalhe', label: 'Detalhe por Professor', icon: UserCheck },
          ].map(tab => {
            const Icon = tab.icon;
            const ativo = aba === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setAba(tab.id)}
                className={`
                  flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all
                  ${ativo
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}
                `}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* CONTEÚDO DA ABA */}
      {aba === 'geral' ? (
        <AbaVisaoGeral
          mesAno={filtros.mesAno}
          onSelecionarProfessor={handleSelecionarProfessor}
        />
      ) : (
        <AbaDetalhe
          professores={professores}
          filtros={filtros}
          setFiltros={setFiltros}
        />
      )}

      {/* MODAL: Preview + confirmar geração */}
      <ModalPreviewRepasses
        isOpen={modalGeracao.isOpen}
        onClose={modalGeracao.fechar}
        mesAno={filtros.mesAno}
        onConfirm={handleGerarRepasses}
      />
    </div>
  );
}