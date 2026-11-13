import React, { useState, useMemo } from 'react';
import { Plus, Clock, CheckCircle, CalendarCheck } from 'lucide-react';
import { useMensalidadesDoAluno } from '../../hooks/useFinanceiro';
import { TableSkeleton } from '../shared/Loading';
import EmptyState from '../ui/EmptyState';
import Surface from '../ui/Surface';
import Button from '../ui/Button';
import ModalAdicionarPagamentoManual from '../ModalAdicionarPagamentoManual';
import TabelaMensalidades from './TabelaMensalidades';
import { useModaisLancamento } from './useModaisLancamento';
import { formatarMoeda, formatarData, hojeBrasilia } from '../../lib/utils';
import {
  resumoFinanceiroAluno,
  filtrarPorStatus,
  ordenarMensalidades,
} from '../../lib/mensalidades';

const FILTROS = [
  { valor: 'todos',     label: 'Todas'     },
  { valor: 'em_aberto', label: 'Em aberto' },
  { valor: 'pago',      label: 'Pagas'     },
];

const ICON_TONE = {
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  info:    'bg-info-soft text-info',
};

const CardResumo = ({ titulo, valor, detalhe, icone, tone }) => (
  <Surface variant="card" className="flex items-center gap-4">
    <div className={`p-4 rounded-2xl shrink-0 ${ICON_TONE[tone]}`}>
      {React.cloneElement(icone, { size: 24 })}
    </div>
    <div>
      <p className="text-muted-foreground text-xs font-bold uppercase tracking-wide">{titulo}</p>
      <p className="text-2xl font-black text-foreground">{valor}</p>
      <p className="text-xs text-muted-foreground">{detalhe}</p>
    </div>
  </Surface>
);

export default function AbaFinanceiroAluno({ aluno, alunoId }) {
  const hoje = hojeBrasilia();
  const { mensalidades, loading, erro, refetch } = useMensalidadesDoAluno(alunoId);
  const { acoes, modais } = useModaisLancamento();
  const [filtro, setFiltro] = useState('todos');
  const [modalAberto, setModalAberto] = useState(false);

  const resumo = useMemo(() => resumoFinanceiroAluno(mensalidades, hoje), [mensalidades, hoje]);
  const lista = useMemo(
    () => ordenarMensalidades(filtrarPorStatus(mensalidades, filtro, hoje), hoje),
    [mensalidades, filtro, hoje],
  );

  const { emAberto, pagoNoAno, ultimoPagamento } = resumo;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h2 className="text-xl font-black text-foreground">Financeiro</h2>
        <Button variant="success" onClick={() => setModalAberto(true)} leftIcon={<Plus size={18} />}>
          Novo lançamento
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CardResumo
          titulo="Em aberto"
          valor={formatarMoeda(emAberto.total)}
          detalhe={`${emAberto.quantidade} ${emAberto.quantidade === 1 ? 'cobrança' : 'cobranças'}`}
          icone={<Clock />}
          tone="warning"
        />
        <CardResumo
          titulo={`Pago em ${pagoNoAno.ano}`}
          valor={formatarMoeda(pagoNoAno.total)}
          detalhe={`${pagoNoAno.quantidade} ${pagoNoAno.quantidade === 1 ? 'cobrança' : 'cobranças'}`}
          icone={<CheckCircle />}
          tone="success"
        />
        <CardResumo
          titulo="Último pagamento"
          valor={ultimoPagamento ? formatarData(ultimoPagamento.data) : '—'}
          detalhe={ultimoPagamento?.forma || '—'}
          icone={<CalendarCheck />}
          tone="info"
        />
      </div>

      <div className="flex gap-1.5">
        {FILTROS.map(({ valor, label }) => (
          <button
            key={valor}
            onClick={() => setFiltro(valor)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              filtro === valor
                ? 'bg-foreground text-background border-foreground'
                : 'bg-card text-muted-foreground border-border hover:border-foreground/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton />
      ) : erro ? (
        <Surface variant="card" className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground">Não foi possível carregar o financeiro deste aluno.</p>
          <Button variant="outline" onClick={() => refetch()}>Tentar de novo</Button>
        </Surface>
      ) : (
        <TabelaMensalidades
          itens={lista}
          mostrarAluno={false}
          acoes={acoes}
          hoje={hoje}
          vazio={<EmptyState titulo="Nenhuma cobrança" mensagem="Nenhuma cobrança lançada para este aluno." />}
        />
      )}

      {modais}

      <ModalAdicionarPagamentoManual
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        alunoFixo={{ id: alunoId, nome_completo: aluno.nome_completo }}
      />
    </div>
  );
}
