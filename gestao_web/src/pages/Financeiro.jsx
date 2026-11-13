import React, { useState, useMemo } from 'react';
import {
  DollarSign, TrendingUp, Clock, CheckCircle, Search, AlertCircle, Plus,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useFinanceiro } from '../hooks/useFinanceiro';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import ModalAdicionarPagamentoManual from '../components/ModalAdicionarPagamentoManual';
import TabelaMensalidades from '../components/financeiro/TabelaMensalidades';
import { useModaisLancamento } from '../components/financeiro/useModaisLancamento';
import { formatarMoeda, valorDevidoMensalidade, hojeBrasilia } from '../lib/utils';
import {
  filtrarPorStatus,
  ordenarMensalidades,
  invalidarConsultasFinanceiras,
} from '../lib/mensalidades';
import Surface from '../components/ui/Surface';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

export default function Financeiro() {
  const dataAtual = new Date();
  const hoje = hojeBrasilia();
  const [filtros, setFiltros] = useState({
    mes: dataAtual.getMonth() + 1,
    ano: dataAtual.getFullYear()
  });

  const queryClient = useQueryClient();
  const { mensalidades, loading } = useFinanceiro(filtros);
  const { acoes, modais } = useModaisLancamento();
  const [busca, setBusca] = useState('');
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState('todos'); // 'todos' | 'atrasado' | 'pendente' | 'pago'

  const metricas = useMemo(() => {
    if (!mensalidades) return { recebido: 0, pendente: 0, atrasado: 0, total: 0 };
    return mensalidades.reduce((acc, m) => {
      const valorOriginal = Number(m.valor_esperado ?? m.planos?.preco) || 0;
      const valorReal = valorDevidoMensalidade(m);
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
  }, [mensalidades, hoje]);

  // Busca por nome primeiro; depois o filtro de status e a ordem de sempre
  // (atrasados mais antigos → pendentes mais próximos → pagos mais recentes).
  const lista = useMemo(() => {
    if (!mensalidades) return [];
    const termo = busca.toLowerCase();
    const porNome = mensalidades.filter((m) =>
      (m.alunos?.nome_completo || m.nome_visitante || '').toLowerCase().includes(termo));
    return ordenarMensalidades(filtrarPorStatus(porNome, filtroStatus, hoje), hoje);
  }, [mensalidades, busca, filtroStatus, hoje]);

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
            {/* Até o ano que vem: renovações podem ter vencimento nele. */}
            {Array.from({ length: dataAtual.getFullYear() + 1 - 2024 + 1 }, (_, i) => 2024 + i).map(ano => (
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
            { valor: 'todos',    label: 'Todos',     tone: 'neutral'      },
            { valor: 'atrasado', label: 'Atrasados', tone: 'destructive'  },
            { valor: 'pendente', label: 'Pendentes', tone: 'warning'      },
            { valor: 'pago',     label: 'Pagos',     tone: 'success'      },
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
      ) : (
        <TabelaMensalidades
          itens={lista}
          mostrarAluno
          acoes={acoes}
          hoje={hoje}
          vazio={<EmptyState titulo="Nenhum registro" mensagem="Não há mensalidades para o período selecionado." />}
        />
      )}

      {modais}

      <ModalAdicionarPagamentoManual
        isOpen={modalAddOpen}
        onClose={() => setModalAddOpen(false)}
        onSucesso={() => invalidarConsultasFinanceiras(queryClient)}
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
