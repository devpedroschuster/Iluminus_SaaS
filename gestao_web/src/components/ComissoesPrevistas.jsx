import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, AlertCircle } from 'lucide-react';
import Surface from './ui/Surface';
import Badge from './ui/Badge';
import Skeleton from './ui/Skeleton';
import { comissoesService } from '../services/comissoesService';
import { formatarMoeda } from '../lib/utils';
import { nomeDoMes, previstosPorProfessor } from '../lib/repasses';

/**
 * ILU-125: comissões previstas de um mês que ainda não começou — os meses
 * seguintes dos ciclos à vista pagos e as mensalidades pagas adiantadas. Elas
 * são gravadas pela apuração diária quando o mês começar; até lá podem mudar
 * (pausa, cancelamento, bolsa). Com `professorId`, só as desse professor; a
 * tela do professor não precisa passar (o banco já filtra as dele).
 */
export default function ComissoesPrevistas({ mesAno, professorId = null, mostrarProfessor = true }) {
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['repasses-previstos', mesAno],
    queryFn: () => comissoesService.preverRepasses(mesAno),
    enabled: !!mesAno,
    staleTime: 1000 * 60 * 2,
  });

  const linhas = professorId ? data.filter((l) => l.professor_id === professorId) : data;
  const grupos = previstosPorProfessor(linhas);
  const total = grupos.reduce((s, g) => s + g.total, 0);

  return (
    <Surface variant="card" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl p-2.5 bg-info-soft text-info shrink-0">
            <CalendarClock size={18} />
          </span>
          <div>
            <p className="font-black text-foreground">Previsto para {nomeDoMes(mesAno)}</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              Meses seguintes de planos pagos à vista e mensalidades já pagas. Cada comissão é lançada
              quando o mês começar; uma pausa, cancelamento ou bolsa até lá muda a previsão.
            </p>
          </div>
        </div>
        {!isLoading && !isError && linhas.length > 0 && (
          <p className="text-lg font-black text-foreground whitespace-nowrap">{formatarMoeda(total)}</p>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={16} className="shrink-0" />
          <span>Não foi possível carregar a previsão: {error?.message ?? 'tente novamente.'}</span>
        </div>
      )}

      {!isLoading && !isError && linhas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma comissão prevista para este mês até agora.</p>
      )}

      {!isLoading && !isError && grupos.map((g) => (
        <div key={g.professor_id} className="space-y-1">
          {mostrarProfessor && (
            <div className="flex items-center justify-between border-b border-border pb-1">
              <p className="text-sm font-black text-foreground">{g.nome}</p>
              <p className="text-sm font-bold text-foreground">{formatarMoeda(g.total)}</p>
            </div>
          )}
          <ul className="divide-y divide-border">
            {g.linhas.map((l) => (
              <li
                key={`${l.aluno_id}-${l.modalidade_id}`}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-bold text-foreground truncate">{l.aluno_nome}</p>
                  <p className="text-xs text-muted-foreground truncate">{l.modalidade}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone="info" variant="soft">Previsto</Badge>
                  <span className="font-bold text-foreground">{formatarMoeda(l.valor)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Surface>
  );
}
