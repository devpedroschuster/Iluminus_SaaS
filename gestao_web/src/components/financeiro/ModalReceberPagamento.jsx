import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Modal from '../ui/Modal';
import Surface from '../ui/Surface';
import Input, { Label } from '../ui/Input';
import Button from '../ui/Button';
import SelectFormaPagamento from '../SelectFormaPagamento';
import RepasseAlunoCard from '../RepasseAlunoCard';
import { showToast } from '../shared/showToast';
import { financeiroService } from '../../services/financeiroService';
import { comissoesService } from '../../services/comissoesService';
import { TIPOS_AULA } from '../../lib/constants';
import { formatarValorInput, parseValorMoeda, hojeBrasilia } from '../../lib/utils';
import { tipoAulaAoReceber, mensagemErroLancamento } from '../../lib/mensalidades';

const NOOP = () => {};

// Produto e evento não têm opção no select de tipo: o tipo fica como está.
const TIPO_FIXO = { produto: 'Produto', evento: 'Evento' };

const ehAvulsaOuExperimental = (tipo) => tipo === 'experimental' || tipo === 'avulsa';

/**
 * "Confirmar Recebimento" e, depois do sucesso, o "Comprovante de Pagamento".
 * O estado inicial vem do lançamento: monte um por abertura (o
 * useModaisLancamento faz isso). `onSalvo` é chamado logo depois de o
 * pagamento ser gravado (o comprovante continua aberto); `onConcluido`, quando
 * o comprovante é fechado; `onErro(error)`, quando a gravação falha.
 */
export default function ModalReceberPagamento({ mensalidade, aberto, fechar, onSalvo, onConcluido, onErro }) {
  // Experimental/avulsa já vêm com professor e modalidade do lançamento.
  const avulsaOuExperimental = ehAvulsaOuExperimental(mensalidade.tipo_aula);
  const [etapa, setEtapa] = useState('formulario');
  const [enviando, setEnviando] = useState(false);
  const [valorPago, setValorPago] = useState(() => formatarValorInput(
    mensalidade.valor_pago ?? mensalidade.valor_esperado ?? mensalidade.planos?.preco,
  ));
  const [formaPagamento, setFormaPagamento] = useState('');
  const [dataPagamento, setDataPagamento] = useState(() => hojeBrasilia());
  const [tipoAula, setTipoAula] = useState(() => tipoAulaAoReceber(mensalidade));
  const [professorId, setProfessorId] = useState(avulsaOuExperimental ? (mensalidade.professor_id || '') : '');
  const [modalidadeNome, setModalidadeNome] = useState(avulsaOuExperimental ? (mensalidade.modalidade_nome || '') : '');
  const [modalidadeId, setModalidadeId] = useState(mensalidade.modalidade_id || '');
  const [resultado, setResultado] = useState(null);
  const [dadosPagamento, setDadosPagamento] = useState(null);

  const { data: professores = [] } = useQuery({
    queryKey: ['professores-ativos'],
    queryFn: () => comissoesService.listarProfessores(),
    enabled: aberto,
    staleTime: 1000 * 60 * 5,
  });

  const { data: modalidadesDoAluno = [] } = useQuery({
    queryKey: ['modalidades-do-aluno', mensalidade.aluno_id],
    queryFn: () => financeiroService.listarModalidadesDoAluno(mensalidade.aluno_id),
    enabled: aberto && !!mensalidade.aluno_id,
  });

  // A modalidade já gravada no lançamento continua escolhível mesmo que o
  // aluno não esteja mais matriculado nela.
  const atual = mensalidade.modalidades;
  const opcoesModalidade = atual?.id && !modalidadesDoAluno.some((m) => m.id === atual.id)
    ? [atual, ...modalidadesDoAluno]
    : modalidadesDoAluno;

  const planoLivre = !!mensalidade.planos?.is_plano_livre;
  const nomeAluno = mensalidade.alunos?.nome_completo || mensalidade.nome_visitante || 'Visitante';

  const handleConfirmar = async (e) => {
    e.preventDefault();
    const valor = parseValorMoeda(valorPago);
    if (!(valor >= 0)) {
      showToast.error('Informe um valor válido.');
      return;
    }
    const comProfessor = ehAvulsaOuExperimental(tipoAula);
    const payload = {
      valor_pago: valor,
      forma_pagamento: formaPagamento,
      tipo_aula: tipoAula,
      professor_id: comProfessor ? professorId : null,
      modalidade_nome: comProfessor ? modalidadeNome : null,
      modalidade_id: tipoAula === 'regular' ? (modalidadeId || null) : null,
      data_pagamento: dataPagamento,
    };
    setEnviando(true);
    try {
      const res = await financeiroService.confirmarPagamento(mensalidade.id, payload);
      onSalvo?.();
      showToast.success('Pagamento processado com sucesso!');
      setResultado(res.resultado);
      setDadosPagamento({
        valor_pago: valor,
        forma_pagamento: formaPagamento,
        data_pagamento: dataPagamento,
      });
      setEtapa('comprovante');
    } catch (error) {
      showToast.error(mensagemErroLancamento(error));
      onErro?.(error);
    } finally {
      setEnviando(false);
    }
  };

  if (etapa === 'comprovante') {
    return (
      <Modal aberto={aberto} fechar={onConcluido} titulo="Comprovante de Pagamento">
        <div className="space-y-4">
          {resultado?.aviso && (
            <div className="flex items-start gap-2 rounded-xl bg-warning-soft border border-warning/20 p-3 text-xs text-foreground">
              <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
              <p>{resultado.aviso}</p>
            </div>
          )}
          {/* Os `avisos` (ex.: comissão reaproveitada) aparecem dentro do card. */}
          <RepasseAlunoCard
            aluno={mensalidade.alunos || { nome_completo: mensalidade.nome_visitante || 'Visitante' }}
            mensalidade={{ tipo_aula: tipoAula, planos: mensalidade.planos }}
            resultado={resultado}
            pagamento={dadosPagamento}
          />
          <Button variant="secondary" fullWidth onClick={onConcluido}>
            Fechar
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal aberto={aberto} fechar={enviando ? NOOP : fechar} titulo="Confirmar Recebimento">
      <form onSubmit={handleConfirmar} className="space-y-6">
        <Surface variant="muted" padding="md">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Aluno</p>
          <p className="font-black text-foreground text-lg mt-0.5">{nomeAluno}</p>
        </Surface>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Valor (R$)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={valorPago}
              onChange={(e) => setValorPago(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Forma</Label>
            <SelectFormaPagamento value={formaPagamento} onChange={setFormaPagamento} required />
          </div>
        </div>
        <div>
          <Label>Data do Pagamento</Label>
          <Input
            type="date"
            value={dataPagamento}
            onChange={(e) => setDataPagamento(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Tipo de Aula</Label>
          {TIPO_FIXO[tipoAula] ? (
            <Surface variant="muted" padding="sm" className="rounded-xl px-4 text-sm font-bold text-foreground">
              {TIPO_FIXO[tipoAula]}
            </Surface>
          ) : (
            <Input
              as="select"
              value={tipoAula}
              onChange={(e) => setTipoAula(e.target.value)}
              disabled={planoLivre}
              title={planoLivre ? 'Plano livre: tipo definido automaticamente' : undefined}
            >
              {TIPOS_AULA.map((t) => (
                <option key={t.valor} value={t.valor}>{t.label}</option>
              ))}
            </Input>
          )}
        </div>
        {tipoAula === 'regular' && (
          <div>
            <Label>Referência (modalidade)</Label>
            <Input as="select" value={modalidadeId} onChange={(e) => setModalidadeId(e.target.value)}>
              <option value="">Todas as modalidades matriculadas (rateio padrão)</option>
              {opcoesModalidade.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </Input>
          </div>
        )}
        {ehAvulsaOuExperimental(tipoAula) && (
          <Surface variant="muted" padding="md" className="grid grid-cols-2 gap-4">
            <Input
              as="select"
              value={professorId}
              onChange={(e) => setProfessorId(e.target.value)}
              required
            >
              <option value="">Professor...</option>
              {professores.map((p) => (
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
        <Button type="submit" variant="brand" size="lg" fullWidth loading={enviando}>
          Confirmar Recebimento
        </Button>
      </form>
    </Modal>
  );
}
