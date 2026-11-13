import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import ModalReceberPagamento from './ModalReceberPagamento';
import ModalEditarLancamento from './ModalEditarLancamento';
import ModalReverterOuExcluir from './ModalReverterOuExcluir';
import { invalidarConsultasFinanceiras } from '../../lib/mensalidades';

/**
 * Ações por linha da TabelaMensalidades e os modais que elas abrem, iguais na
 * tela Mensalidades e na aba Financeiro do aluno.
 *
 * Uso: `const { acoes, modais } = useModaisLancamento();` e então
 * `<TabelaMensalidades acoes={acoes} ... />` e `{modais}` no JSX.
 *
 * Cada modal é montado só enquanto está aberto (com `key` pelo lançamento),
 * então o formulário sempre começa dos dados da linha clicada. Depois de
 * qualquer ação concluída, invalida as consultas financeiras das duas telas
 * e a lista de comissões, e fecha.
 */
export function useModaisLancamento() {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(null); // { modal, item } | null

  const acoes = useMemo(() => ({
    receber: (item) => setAberto({ modal: 'receber', item }),
    editar: (item) => setAberto({ modal: 'editar', item }),
    reverter: (item) => setAberto({ modal: 'reverter', item }),
    excluir: (item) => setAberto({ modal: 'excluir', item }),
  }), []);

  const fechar = () => setAberto(null);

  const concluir = () => {
    invalidarConsultasFinanceiras(queryClient);
    queryClient.invalidateQueries({ queryKey: ['comissoes-mensalidade'] });
    setAberto(null);
  };

  const modal = aberto?.modal;
  const item = aberto?.item;
  const chave = item ? `${modal}-${item.id}` : undefined;

  const modais = item ? (
    <>
      {modal === 'receber' && (
        <ModalReceberPagamento key={chave} mensalidade={item} aberto fechar={fechar} onConcluido={concluir} />
      )}
      {modal === 'editar' && (
        <ModalEditarLancamento key={chave} mensalidade={item} aberto fechar={fechar} onConcluido={concluir} />
      )}
      {(modal === 'reverter' || modal === 'excluir') && (
        <ModalReverterOuExcluir
          key={chave}
          mensalidade={item}
          modo={modal}
          aberto
          fechar={fechar}
          onConcluido={concluir}
        />
      )}
    </>
  ) : null;

  return { acoes, modais };
}

export default useModaisLancamento;
