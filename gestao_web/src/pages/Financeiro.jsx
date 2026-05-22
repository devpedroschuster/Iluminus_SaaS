import React, { useState, useMemo, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, CreditCard, Smartphone, 
  Banknote, Clock, CheckCircle, Search, RefreshCw, AlertCircle, Calendar, FileSpreadsheet, Plus
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
    const hoje = new Date().toISOString().split('T')[0];
    
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

  const alunosFiltrados = mensalidades?.filter(m => {
    const nomeBase = m.alunos?.nome_completo || m.nome_visitante || '';
    return nomeBase.toLowerCase().includes(busca.toLowerCase());
  });

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
                <th className="p-4 font-bold text-muted-foreground uppercase text-xs text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {alunosFiltrados.map((item) => (
                <tr key={item.id} className="hover:bg-primary-soft/20 transition-colors">
                  <td className="p-4 font-bold text-foreground flex items-center gap-2">
                    {item.alunos?.nome_completo || item.nome_visitante || 'Visitante'}
                    {!item.alunos && item.nome_visitante && (
                      <Badge tone="neutral" variant="soft" className="text-[9px]">Avulso</Badge>
                    )}
                  </td>
                  <td className="p-4 text-muted-foreground font-medium">
                    {new Date(item.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
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
                    <Badge tone={item.status === 'pago' ? 'success' : 'warning'}>
                      {item.status.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    {item.status !== 'pago' && (
                      <Button
                        variant="brand"
                        size="sm"
                        onClick={() => handleAbrirPagamento(item)}
                      >
                        Receber
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
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