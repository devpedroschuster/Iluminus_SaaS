import React from 'react';
import { CalendarRange } from 'lucide-react';
import Surface from '../ui/Surface';
import { Label } from '../ui/Input';
import { formatarData } from '../../lib/utils';
import { mesesDoCiclo } from '../../lib/repasses';

// ILU-125: a escolha vem de useCoberturaDoCiclo (./useCoberturaDoCiclo).

function periodo(ciclo) {
  return `${formatarData(ciclo.data_inicio)} a ${formatarData(ciclo.data_fim)}`;
}

/** A escolha "só este mês / o ciclo inteiro", ou o aviso de que já é a integral. */
export default function CoberturaDoCiclo({ cobertura }) {
  const { ciclo, situacao, cobreCiclo, setCobreCiclo } = cobertura;
  if (!ciclo || !situacao) return null;
  const meses = mesesDoCiclo(ciclo.data_inicio, ciclo.data_fim);
  const plano = ciclo.planos?.nome ? `${ciclo.planos.nome}, ` : '';

  if (situacao === 'ja_integral') {
    return (
      <Surface variant="muted" padding="md" className="flex items-start gap-2 text-xs text-foreground">
        <CalendarRange size={14} className="text-primary shrink-0 mt-0.5" />
        <p>
          Pagamento integral do ciclo ({plano}{periodo(ciclo)}): cobre os {meses} meses. A comissão de
          cada mês entra quando o mês começar.
        </p>
      </Surface>
    );
  }

  const opcoes = [
    { cobre: false, rotulo: 'Só este mês' },
    { cobre: true, rotulo: `O ciclo inteiro (${meses} meses)` },
  ];
  return (
    <div className="space-y-2">
      <Label>Este pagamento cobre</Label>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Este pagamento cobre">
        {opcoes.map((op) => (
          <button
            key={op.rotulo}
            type="button"
            onClick={() => setCobreCiclo(op.cobre)}
            aria-pressed={cobreCiclo === op.cobre}
            className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
              cobreCiclo === op.cobre
                ? 'bg-primary text-white border-primary'
                : 'bg-card text-foreground/70 border-border hover:bg-muted'
            }`}
          >
            {op.rotulo}
          </button>
        ))}
      </div>
      <p className="text-[11px] font-medium text-muted-foreground">
        Ciclo {plano}{periodo(ciclo)}.{' '}
        {cobreCiclo
          ? `Gera comissão em cada um dos ${meses} meses, quando cada mês começar.${
            ciclo.forma_recebimento === 'a_vista'
              ? ''
              : ' O ciclo passa a ser à vista e as mensalidades em aberto dentro dele são removidas.'}`
          : 'Gera comissão só para o mês do vencimento.'}
      </p>
    </div>
  );
}
