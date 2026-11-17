import React from 'react';
import { Pencil, Trash2, Undo2 } from 'lucide-react';
import Surface from '../ui/Surface';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { formatarMoeda, valorDevidoMensalidade, hojeBrasilia } from '../../lib/utils';
import { calcularStatusReal, rotuloReferencia, rotuloFormaPagamento } from '../../lib/mensalidades';

const TH = 'p-4 font-bold text-muted-foreground uppercase text-xs';

const formatarDia = (data) => new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR');

const nomeDoLancamento = (item) => item.alunos?.nome_completo || item.nome_visitante || 'Visitante';

function Referencia({ item }) {
  if (item.tipo_aula === 'regular') {
    return item.modalidades?.nome
      ? <Badge tone="info" variant="soft">{item.modalidades.nome}</Badge>
      : <span className="text-muted-foreground text-xs">Todas</span>;
  }
  const rotulo = rotuloReferencia(item);
  return rotulo
    ? <Badge tone="neutral" variant="soft">{rotulo}</Badge>
    : <span className="text-muted-foreground text-xs">—</span>;
}

/**
 * Tabela de cobranças usada pela tela Mensalidades e pela aba Financeiro do
 * aluno. Recebe `itens` já filtrados e ordenados; `acoes` = { receber, editar,
 * reverter, excluir }, cada uma chamada com o item da linha.
 */
export default function TabelaMensalidades({ itens, mostrarAluno = false, acoes, hoje = hojeBrasilia(), vazio = null }) {
  if (!itens?.length) return vazio;

  const total = itens.reduce((acc, item) => acc + valorDevidoMensalidade(item), 0);

  return (
    <Surface variant="card" padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted border-b border-border">
              {mostrarAluno && <th className={TH}>Aluno</th>}
              <th className={TH}>Vencimento</th>
              <th className={TH}>Valor</th>
              <th className={TH}>Forma Pag.</th>
              <th className={TH}>Dt. Pagamento</th>
              <th className={TH}>Referência</th>
              <th className={TH}>Status</th>
              <th className={`${TH} text-right`}>Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itens.map((item) => {
              const { tipo: statusReal, diasAtraso } = calcularStatusReal(item, hoje);
              const paga = item.status === 'pago';
              return (
                <tr
                  key={item.id}
                  className={`hover:bg-primary-soft/20 transition-colors ${
                    statusReal === 'atrasado' ? 'bg-destructive-soft/20' : ''
                  }`}
                >
                  {mostrarAluno && (
                    <td className="p-4 font-bold text-foreground flex items-center gap-2">
                      {nomeDoLancamento(item)}
                      {!item.alunos && item.nome_visitante && (
                        <Badge tone="neutral" variant="soft" className="text-[9px]">Avulso</Badge>
                      )}
                    </td>
                  )}
                  <td className="p-4 font-medium">
                    <span className={statusReal === 'atrasado' ? 'text-destructive font-bold' : 'text-muted-foreground'}>
                      {formatarDia(item.data_vencimento)}
                    </span>
                    {statusReal === 'atrasado' && (
                      <p className="text-[10px] text-destructive font-bold mt-0.5">
                        há {diasAtraso} {diasAtraso === 1 ? 'dia' : 'dias'}
                      </p>
                    )}
                  </td>
                  <td className="p-4 font-bold text-foreground">
                    {formatarMoeda(valorDevidoMensalidade(item))}
                  </td>
                  <td className="p-4">
                    {paga && item.forma_pagamento ? (
                      <Badge tone="neutral" variant="soft">
                        {rotuloFormaPagamento(item.forma_pagamento)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-4 text-muted-foreground font-medium text-sm">
                    {item.data_pagamento
                      ? formatarDia(item.data_pagamento)
                      : <span className="text-xs">—</span>}
                  </td>
                  <td className="p-4">
                    <Referencia item={item} />
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
                      {paga ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Undo2 size={14} />}
                          onClick={() => acoes.reverter(item)}
                          title="Reverter pagamento"
                        >
                          Reverter
                        </Button>
                      ) : (
                        <Button variant="brand" size="sm" onClick={() => acoes.receber(item)}>
                          Receber
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => acoes.editar(item)}
                        title="Editar lançamento"
                        aria-label="Editar lançamento"
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => acoes.excluir(item)}
                        title="Excluir lançamento"
                        aria-label="Excluir lançamento"
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
          {/* Rodapé: contagem + total do que está na lista. As células somam as
              colunas do cabeçalho (8 com Aluno, 7 sem); o Total fica sob Ações. */}
          <tfoot>
            <tr className="bg-muted border-t-2 border-border">
              <td className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wide">
                {itens.length}{' '}
                {itens.length === 1 ? 'registro' : 'registros'}
              </td>
              <td colSpan={mostrarAluno ? 6 : 5} />
              <td className="p-4 text-right">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide mr-2">
                  Total
                </span>
                <span className="text-base font-black text-foreground">
                  {formatarMoeda(total)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Surface>
  );
}
