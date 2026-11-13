import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../ui/Modal';
import Surface from '../ui/Surface';
import Input, { Label } from '../ui/Input';
import Button from '../ui/Button';
import SelectFormaPagamento from '../SelectFormaPagamento';
import { showToast } from '../shared/showToast';
import { financeiroService } from '../../services/financeiroService';
import { parseValorMoeda } from '../../lib/utils';
import { formEdicaoInicial, montarPayloadEdicao, mensagemErroLancamento } from '../../lib/mensalidades';

const NOOP = () => {};

/**
 * Edita uma cobrança sem mexer no status (para isso existem Receber e
 * Reverter). Linha paga: vencimento, valor pago, forma, data de pagamento e
 * modalidade. Linha em aberto: vencimento, valor a receber e modalidade.
 * O estado inicial vem do lançamento: monte um por abertura (o
 * useModaisLancamento faz isso). `onErro(error)` é chamado quando a gravação
 * falha (por exemplo, a linha mudou de status em outra tela).
 */
export default function ModalEditarLancamento({ mensalidade, aberto, fechar, onConcluido, onErro }) {
  const paga = mensalidade.status === 'pago';
  const regular = mensalidade.tipo_aula === 'regular';
  const [form, setForm] = useState(() => formEdicaoInicial(mensalidade));
  const [salvando, setSalvando] = useState(false);

  const { data: modalidadesDoAluno = [] } = useQuery({
    queryKey: ['modalidades-do-aluno', mensalidade.aluno_id],
    queryFn: () => financeiroService.listarModalidadesDoAluno(mensalidade.aluno_id),
    enabled: aberto && regular && !!mensalidade.aluno_id,
  });

  // A modalidade já gravada no lançamento continua escolhível mesmo que o
  // aluno não esteja mais matriculado nela.
  const atual = mensalidade.modalidades;
  const opcoesModalidade = atual?.id && !modalidadesDoAluno.some((m) => m.id === atual.id)
    ? [atual, ...modalidadesDoAluno]
    : modalidadesDoAluno;

  const alterar = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (!(parseValorMoeda(form.valor) >= 0)) {
      showToast.error('Informe um valor válido.');
      return;
    }
    setSalvando(true);
    try {
      await financeiroService.atualizarLancamento(mensalidade.id, montarPayloadEdicao(mensalidade, form), paga);
      showToast.success('Lançamento atualizado com sucesso!');
      onConcluido();
    } catch (error) {
      showToast.error(mensagemErroLancamento(error));
      onErro?.(error);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} fechar={salvando ? NOOP : fechar} titulo="Editar Lançamento">
      <form onSubmit={handleSalvar} className="space-y-5">
        <Surface variant="muted" padding="md">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Aluno</p>
          <p className="font-black text-foreground text-lg mt-0.5">
            {mensalidade.alunos?.nome_completo || mensalidade.nome_visitante || 'Visitante'}
          </p>
        </Surface>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Vencimento</Label>
            <Input
              type="date"
              value={form.data_vencimento}
              onChange={(e) => alterar('data_vencimento')(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>{paga ? 'Valor Pago (R$)' : 'Valor a receber (R$)'}</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={form.valor}
              onChange={(e) => alterar('valor')(e.target.value)}
              placeholder="0,00"
              required
            />
          </div>
        </div>
        {paga && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Forma de Pagamento</Label>
              <SelectFormaPagamento value={form.forma_pagamento} onChange={alterar('forma_pagamento')} />
            </div>
            <div>
              <Label>Data do Pagamento</Label>
              <Input
                type="date"
                value={form.data_pagamento}
                onChange={(e) => alterar('data_pagamento')(e.target.value)}
              />
            </div>
          </div>
        )}
        {regular && (
          <div>
            <Label>Referência (modalidade)</Label>
            <Input
              as="select"
              value={form.modalidade_id}
              onChange={(e) => alterar('modalidade_id')(e.target.value)}
            >
              <option value="">Todas as modalidades matriculadas (rateio padrão)</option>
              {opcoesModalidade.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </Input>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" fullWidth onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="submit" variant="brand" fullWidth disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
