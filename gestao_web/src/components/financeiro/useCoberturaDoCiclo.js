import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { financeiroService } from '../../services/financeiroService';
import { situacaoCoberturaCiclo } from '../../lib/repasses';

/**
 * ILU-125: o ciclo do aluno em que cai o pagamento e se ele cobre só o mês ou
 * o ciclo inteiro (à vista). Sem escolha da pessoa, vale "ciclo inteiro"
 * quando o ciclo já está gravado como à vista.
 *
 * `onSugerir(cobreCiclo, ciclo, origem)` é chamado quando a escolha muda, para
 * a tela sugerir o valor: origem 'escolha' (clique da pessoa) ou 'padrao' (o
 * ciclo à vista carregou com "ciclo inteiro" marcado — a tela só deve trocar
 * um valor que ainda é o mensal).
 * `cicloIdParaLigar` vai como `ciclo_id` para o financeiroService.
 */
export function useCoberturaDoCiclo({ alunoId, vencimento, mensalidadeId = null, ativo = true, onSugerir }) {
  const habilitado = !!ativo && !!alunoId && !!vencimento;
  const { data: ciclo = null } = useQuery({
    queryKey: ['ciclo-do-vencimento', alunoId, vencimento],
    queryFn: () => financeiroService.buscarCicloDoVencimento(alunoId, vencimento),
    enabled: habilitado,
    staleTime: 1000 * 30,
  });
  const cicloVisivel = habilitado ? ciclo : null;
  const situacao = situacaoCoberturaCiclo(cicloVisivel, mensalidadeId);

  // A escolha vale só para o ciclo em que foi feita.
  const [escolha, setEscolha] = useState(null);
  const escolhaValida = escolha && escolha.cicloId === cicloVisivel?.id ? escolha.cobre : null;
  const padrao = cicloVisivel?.forma_recebimento === 'a_vista';
  const cobreCiclo = situacao === 'escolher' ? (escolhaValida ?? padrao) : false;

  const sugerir = useRef(onSugerir);
  sugerir.current = onSugerir;

  // Ao carregar outro ciclo com "ciclo inteiro" como padrão, sugere o valor.
  const cicloId = situacao === 'escolher' ? cicloVisivel?.id : null;
  useEffect(() => {
    if (cicloId && padrao) sugerir.current?.(true, cicloVisivel, 'padrao');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cicloId]);

  const setCobreCiclo = (cobre) => {
    if (!cicloVisivel) return;
    setEscolha({ cicloId: cicloVisivel.id, cobre });
    sugerir.current?.(cobre, cicloVisivel, 'escolha');
  };

  return {
    ciclo: cicloVisivel,
    situacao,
    cobreCiclo,
    setCobreCiclo,
    cicloIdParaLigar: cobreCiclo ? cicloVisivel.id : null,
  };
}
