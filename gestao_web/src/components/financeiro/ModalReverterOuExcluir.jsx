import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { showToast } from '../shared/showToast';
import { financeiroService } from '../../services/financeiroService';
import { formatarMoeda, formatarData, valorDevidoMensalidade } from '../../lib/utils';
import {
  comissaoMarcadaPorPadrao,
  rotuloMesReferencia,
  rotuloFormaPagamento,
  mensagemErroLancamento,
} from '../../lib/mensalidades';

const NOOP = () => {};

const TEXTOS = {
  reverter: {
    titulo: 'Reverter Pagamento',
    confirmar: 'Reverter',
    caixa: 'Reverter esta comissão também',
    sucesso: 'Pagamento revertido.',
  },
  excluir: {
    titulo: 'Excluir Lançamento',
    confirmar: 'Excluir',
    caixa: 'Remover esta comissão também',
    sucesso: 'Lançamento excluído.',
  },
};

const mesDaComissao = (c) => (c.data_referencia ? rotuloMesReferencia(c.data_referencia) : '—');

function mensagemConfirmacao(modo, m) {
  if (modo === 'reverter') {
    return `Reverter o pagamento de ${formatarMoeda(valorDevidoMensalidade(m))} recebido em ${formatarData(m.data_pagamento)} (${rotuloFormaPagamento(m.forma_pagamento)})? O lançamento volta a ficar em aberto.`;
  }
  const nome = m.alunos?.nome_completo || m.nome_visitante || 'Visitante';
  return `Excluir o lançamento de ${nome} com vencimento em ${formatarData(m.data_vencimento)}? Esta ação não pode ser desfeita.`;
}

function EsqueletoComissoes() {
  return (
    <div className="space-y-2 animate-pulse" aria-label="Carregando comissões">
      {[1, 2].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-muted" />
      ))}
    </div>
  );
}

/**
 * Confirmação de Reverter (linha paga) ou Excluir (qualquer linha). Se a
 * cobrança tem comissões, lista cada uma com a caixa para removê-la junto
 * (spec §6.1). Se a lista não carrega, o confirmar fica desabilitado: nunca
 * segue como "sem comissão". `onErro(error)` é chamado quando a ação falha.
 */
export default function ModalReverterOuExcluir({ mensalidade, modo, aberto, fechar, onConcluido, onErro }) {
  const textos = TEXTOS[modo];
  const [escolhas, setEscolhas] = useState({});
  const [enviando, setEnviando] = useState(false);

  const { data: comissoes = [], isPending, isError, isFetching } = useQuery({
    queryKey: ['comissoes-mensalidade', mensalidade.id],
    queryFn: () => financeiroService.listarComissoesDaMensalidade(mensalidade.id),
    enabled: aberto,
  });

  const marcada = (c) => escolhas[c.id] ?? comissaoMarcadaPorPadrao(c);
  const alternar = (c) => setEscolhas((atual) => ({ ...atual, [c.id]: !marcada(c) }));

  const podeConfirmar = !isError && !isPending && !isFetching && !enviando;

  const handleConfirmar = async () => {
    const ids = comissoes.filter(marcada).map((c) => c.id);
    setEnviando(true);
    try {
      if (modo === 'reverter') {
        await financeiroService.reverterPagamento(mensalidade.id, ids);
      } else {
        await financeiroService.excluirLancamento(mensalidade.id, ids);
      }
      showToast.success(textos.sucesso);
      onConcluido();
    } catch (error) {
      showToast.error(mensagemErroLancamento(error));
      onErro?.(error);
    } finally {
      setEnviando(false);
    }
  };

  let corpo = null;
  if (isError) {
    corpo = (
      <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive-soft border border-destructive/30 text-sm font-medium text-foreground">
        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-destructive" />
        <span>Não foi possível carregar as comissões deste lançamento. Feche e tente de novo.</span>
      </div>
    );
  } else if (isPending) {
    corpo = <EsqueletoComissoes />;
  } else if (comissoes.length > 0) {
    corpo = (
      <ul className="space-y-2">
        {comissoes.map((c) => (
          <li key={c.id} className="space-y-2 p-3 rounded-xl bg-background border border-border">
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
              <span>
                {c.professor_nome || 'Professor'} — {c.modalidade || '—'} — {formatarMoeda(c.valor)} — {mesDaComissao(c)}
              </span>
              {c.do_lote && <Badge tone="info" variant="soft">lote mensal</Badge>}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary cursor-pointer"
                checked={marcada(c)}
                onChange={() => alternar(c)}
              />
              {textos.caixa}
            </label>
            {c.mes_fechado && (
              <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>Comissões de {mesDaComissao(c)} já foram fechadas — remover muda o que foi fechado</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Modal
      aberto={aberto}
      fechar={enviando ? NOOP : fechar}
      titulo={textos.titulo}
      size="md"
      footer={(
        <>
          <Button variant="outline" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant={modo === 'excluir' ? 'destructive' : 'brand'}
            onClick={handleConfirmar}
            disabled={!podeConfirmar}
            loading={enviando}
          >
            {textos.confirmar}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground leading-relaxed">
          {mensagemConfirmacao(modo, mensalidade)}
        </p>
        {corpo}
      </div>
    </Modal>
  );
}
