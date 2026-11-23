import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { financeiroService } from '../services/financeiroService';
import { alunosService } from '../services/alunosService';
import { planosValidos, planoSugerido, rotuloPlanoAluno } from '../lib/planosAluno';
import { showToast } from './shared/showToast';
import { formatarMoeda, hojeBrasilia, valorDevidoMensalidade } from '../lib/utils';
import { invalidarConsultasFinanceiras, mensagemErroLancamento, ErroLancamento } from '../lib/mensalidades';
import { valorDoCiclo } from '../lib/repasses';
import CoberturaDoCiclo from './financeiro/CoberturaDoCiclo';
import { useCoberturaDoCiclo } from './financeiro/useCoberturaDoCiclo';
import { User, DollarSign, Calendar, BookOpen, GraduationCap, Package, CreditCard, LayoutList, Loader2 } from 'lucide-react';

/**
 * Traduz erros técnicos do Supabase/Postgres para mensagens humanas.
 */
function traduzirErroRegistro(error) {
  const msg = error?.message || '';
  const code = error?.code || '';

  // Pagamento duplicado (unique constraint)
  // (o índice é aluno + plano + vencimento — não tem a ver com outros
  // lançamentos do aluno, como aula experimental ou avulsa)
  if (code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint')) {
    return 'Esse aluno já tem um lançamento deste plano com esse mesmo vencimento. Confira no Financeiro ou use outra data de vencimento.';
  }
  // Foreign key — aluno ou plano não existe mais
  if (code === '23503' || msg.includes('foreign key')) {
    return 'O aluno ou plano selecionado não foi encontrado. Atualize a página e tente de novo.';
  }
  // CHECK do banco recusou tipo de recebimento / forma de pagamento — antes
  // caía no fallback genérico (era o caso de toda venda de produto/evento)
  if (code === '23514' || msg.includes('check constraint')) {
    return 'Tipo de recebimento ou forma de pagamento não aceito pelo sistema. Avise o suporte.';
  }
  // Sem permissão
  if (code === '42501' || msg.includes('permission denied')) {
    return 'Você não tem permissão para registrar este pagamento.';
  }
  // Valor inválido
  if (msg.includes('invalid input') || msg.includes('numeric')) {
    return 'O valor informado é inválido. Verifique e tente de novo.';
  }
  // Fallback genérico — sem expor stack técnica
  return 'Não foi possível registrar o pagamento. Verifique os dados e tente de novo.';
}

function getInitialForm() {
  return {
    aluno_id: '',
    nome_visitante: '',
    tipo_aula: 'regular',
    plano_id: '',
    modalidade_id: '',
    valor_pago: '',
    forma_pagamento: 'pix',
    data_pagamento: hojeBrasilia(),
    data_vencimento: hojeBrasilia(),
    professor_id: '',
    modalidade_nome: '',
  };
}

export default function ModalAdicionarPagamentoManual({ isOpen, onClose, onSucesso, alunoFixo }) {
  const queryClient = useQueryClient();
  const [alunos, setAlunos] = useState([]);
  const [planos, setPlanos] = useState([]);
  const [professores, setProfessores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isVisitante, setIsVisitante] = useState(false);
  const [modalidadesDoAluno, setModalidadesDoAluno] = useState([]);
  // Cobranças de plano em aberto do aluno. A selecionada é quitada por este
  // lançamento, em vez de criar outra mensalidade ao lado dela.
  const [cobrancasEmAberto, setCobrancasEmAberto] = useState([]);
  const [cobrancaId, setCobrancaId] = useState('');

  // "Já foi pago" (padrão) ou "Fica em aberto" — só vale para aluno cadastrado.
  const [emAberto, setEmAberto] = useState(false);
  const lancarEmAberto = emAberto && !isVisitante;

  const [form, setForm] = useState(getInitialForm);

  // Vários planos por aluno: a cobrança de plano pertence a um deles.
  const [planoAlunoEscolhido, setPlanoAlunoEscolhido] = useState('');
  const alunoIdAtual = alunoFixo?.id ?? form.aluno_id;
  const cobrancaDePlano = (form.tipo_aula === 'regular' || form.tipo_aula === 'plano_livre') && !isVisitante;
  const { data: planosDoAluno = [], isLoading: carregandoPlanosDoAluno, isError: erroPlanosDoAluno } = useQuery({
    queryKey: ['aluno-planos-aluno', String(alunoIdAtual)],
    queryFn: () => alunosService.listarPlanosDoAluno(alunoIdAtual),
    enabled: isOpen && cobrancaDePlano && !!alunoIdAtual,
  });
  const validosDoAluno = planosValidos(planosDoAluno, hojeBrasilia());
  const precisaEscolherPlano = cobrancaDePlano && validosDoAluno.length > 1;
  const planoAlunoId = cobrancaDePlano
    ? planoSugerido(validosDoAluno, planoAlunoEscolhido || null)
    : null;
  const bloqueadoPorPlanos = cobrancaDePlano && !!alunoIdAtual && (carregandoPlanosDoAluno || erroPlanosDoAluno);
  const aguardandoPlano = cobrancaDePlano && !!alunoIdAtual && (carregandoPlanosDoAluno || (precisaEscolherPlano && !planoAlunoId));

  const cobrancaParaQuitar = form.tipo_aula === 'regular' && !isVisitante && !lancarEmAberto
    ? cobrancasEmAberto.find(c => String(c.id) === cobrancaId)
    : null;

  // ILU-125: mensalidade de um ciclo de vários meses pode cobrir o ciclo
  // inteiro (à vista). O ciclo é o do vencimento da cobrança quitada ou, num
  // lançamento novo, o da data de vencimento informada.
  const precoDoPlano = Number(planos.find(p => String(p.id) === String(form.plano_id))?.preco);
  const valorDoMes = cobrancaParaQuitar ? valorDevidoMensalidade(cobrancaParaQuitar) : (precoDoPlano || '');
  const cobertura = useCoberturaDoCiclo({
    alunoId: alunoFixo?.id ?? form.aluno_id,
    vencimento: cobrancaParaQuitar ? cobrancaParaQuitar.data_vencimento : form.data_vencimento,
    mensalidadeId: cobrancaParaQuitar?.id ?? null,
    planoAlunoId,
    ativo: isOpen && form.tipo_aula === 'regular' && !isVisitante && !aguardandoPlano,
    onSugerir: (cobre, ciclo, origem) => {
      setForm(f => {
        if (origem === 'padrao') {
          const atual = Number(f.valor_pago);
          return !f.valor_pago || atual === precoDoPlano || atual === Number(valorDoMes)
            ? { ...f, valor_pago: valorDoCiclo(ciclo) }
            : f;
        }
        return { ...f, valor_pago: cobre ? valorDoCiclo(ciclo) : valorDoMes };
      });
    },
  });

  useEffect(() => {
    if (isOpen) {
      carregarDados();
    } else {
      setForm(getInitialForm());
      setIsVisitante(false);
      setEmAberto(false);
      setPlanoAlunoEscolhido('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, alunoFixo?.id]);

  useEffect(() => {
    setCobrancasEmAberto([]);
    setCobrancaId('');
    if (!isOpen || isVisitante || lancarEmAberto || !form.aluno_id || aguardandoPlano) return;

    // Ignora resposta obsoleta se o aluno mudar antes de resolver.
    let cancelado = false;
    financeiroService.listarCobrancasEmAbertoDoAluno(form.aluno_id, planoAlunoId || undefined)
      .then(cobrancas => {
        if (cancelado) return;
        setCobrancasEmAberto(cobrancas);
        // Vem da mais recente para a mais antiga: a do ciclo atual é a que
        // normalmente está sendo paga.
        const maisRecente = cobrancas[0];
        if (maisRecente) {
          setCobrancaId(String(maisRecente.id));
          setForm(f => ({ ...f, valor_pago: valorDevidoMensalidade(maisRecente) }));
        }
      })
      .catch(error => {
        if (cancelado) return;
        console.error('[ModalAdicionarPagamentoManual] Erro ao buscar cobranças em aberto:', error);
        showToast.warning('Não foi possível verificar as cobranças em aberto deste aluno. Confira no Financeiro antes de lançar.');
      });
    return () => { cancelado = true; };
  }, [isOpen, isVisitante, lancarEmAberto, form.aluno_id, planoAlunoId, aguardandoPlano]);

  const handleCobrancaChange = (id) => {
    setCobrancaId(id);
    const cobranca = cobrancasEmAberto.find(c => String(c.id) === id);
    if (cobranca) setForm(f => ({ ...f, valor_pago: valorDevidoMensalidade(cobranca) }));
  };

  async function carregarDados() {
    const { data: p } = await supabase.from('planos').select('id, nome, preco');
    const { data: profs } = await supabase.from('professores').select('id, nome');
    if (p) setPlanos(p);
    if (profs) setProfessores(profs);

    if (alunoFixo) {
      // Aluno vem travado: não carrega a lista, só o plano padrão dele.
      const { data: aluno } = await supabase.from('alunos').select('id, nome_completo, plano_id').eq('id', alunoFixo.id).maybeSingle();
      const defaultPlano = aluno?.plano_id || '';
      const planoObj = (p || []).find(pl => pl.id === defaultPlano);
      setForm(f => ({
        ...f,
        aluno_id: alunoFixo.id,
        plano_id: defaultPlano,
        valor_pago: planoObj ? planoObj.preco : f.valor_pago,
        modalidade_id: '',
      }));
      setModalidadesDoAluno(await financeiroService.listarModalidadesDoAluno(alunoFixo.id));
      return;
    }

    const { data: a } = await supabase.from('alunos').select('id, nome_completo, plano_id').order('nome_completo');
    if (a) setAlunos(a);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (erroPlanosDoAluno && cobrancaDePlano && alunoIdAtual) {
      showToast.error('Não foi possível carregar os planos do aluno.');
      return;
    }
    if (carregandoPlanosDoAluno && cobrancaDePlano && alunoIdAtual) return;
    if (precisaEscolherPlano && !planoAlunoId) {
      showToast.error('Escolha o plano do aluno.');
      return;
    }
    setLoading(true);
    // Aluno travado: o id vem direto de alunoFixo, mesmo que o envio seja
    // mais rápido que o carregarDados preencher form.aluno_id.
    const alunoId = alunoFixo?.id ?? form.aluno_id;
    let quitando = false;

    try {
      const nomeCompleto = alunoFixo?.nome_completo
        || alunos.find(a => String(a.id) === String(form.aluno_id))?.nome_completo;
      const nomeAluno = nomeCompleto?.split(' ')[0] || 'Aluno';

      if (lancarEmAberto) {
        const payloadAberto = {
          aluno_id: alunoId,
          tipo_aula: form.tipo_aula,
          status: 'pendente',
          valor_esperado: form.valor_pago,
          data_vencimento: form.data_vencimento,
          ciclo_id: cobertura.cicloIdParaLigar,
        };
        if (form.tipo_aula === 'regular' && form.plano_id) {
          payloadAberto.plano_id = form.plano_id;
          payloadAberto.modalidade_id = form.modalidade_id || null;
        }
        if (cobrancaDePlano && planoAlunoId) payloadAberto.plano_aluno_id = planoAlunoId;
        if (form.tipo_aula === 'avulsa') {
          payloadAberto.professor_id = form.professor_id;
          payloadAberto.modalidade_nome = form.modalidade_nome;
        }

        const resAberto = await financeiroService.adicionarPagamentoManual(payloadAberto);
        showToast.success(resAberto?._ciclo
          ? `Cobrança de ${nomeAluno} lançada em aberto, cobrindo os ${resAberto._ciclo.meses} meses do ciclo.`
          : `Cobrança de ${nomeAluno} lançada em aberto.`);
        (resAberto?._avisosRepasse ?? []).forEach((aviso, i) => {
          setTimeout(() => showToast.warning(`⚠️ ${aviso}`), 600 * (i + 1));
        });
        invalidarConsultasFinanceiras(queryClient);
        onSucesso?.();
        onClose();
        return;
      }

      if (cobrancaParaQuitar) {
        quitando = true;
        const { resultado } = await financeiroService.confirmarPagamento(cobrancaParaQuitar.id, {
          valor_pago: Number(form.valor_pago),
          forma_pagamento: form.forma_pagamento,
          tipo_aula: cobrancaParaQuitar.tipo_aula,
          modalidade_id: form.modalidade_id || null,
          data_pagamento: form.data_pagamento,
          ciclo_id: cobertura.cicloIdParaLigar,
        });

        showToast.success(resultado?.ciclo
          ? `✅ Pagamento de ${nomeAluno} registrado, cobrindo os ${resultado.ciclo.meses} meses do ciclo!`
          : `✅ Pagamento de ${nomeAluno} registrado na mensalidade em aberto!`);
        // Avisos em toasts separados — não substituem a confirmação de sucesso
        const avisos = [resultado?.aviso, ...(resultado?.avisos || [])].filter(Boolean);
        avisos.forEach((aviso, i) => {
          setTimeout(() => showToast.warning(`⚠️ ${aviso}`), 600 * (i + 1));
        });

        invalidarConsultasFinanceiras(queryClient);
        onSucesso?.();
        onClose();
        return;
      }

      const payload = {
        aluno_id: isVisitante ? null : alunoId,
        nome_visitante: isVisitante ? form.nome_visitante : null,
        tipo_aula: form.tipo_aula,
        valor_pago: Number(form.valor_pago),
        forma_pagamento: form.forma_pagamento,
        data_vencimento: form.data_vencimento,
        status: 'pago',
        data_pagamento: form.data_pagamento,
      };

      if (form.tipo_aula === 'regular' && form.plano_id) {
        payload.plano_id = form.plano_id;
        payload.modalidade_id = form.modalidade_id || null;
      }
      if (cobrancaDePlano && planoAlunoId) payload.plano_aluno_id = planoAlunoId;
      if (form.tipo_aula === 'avulsa') {
        payload.professor_id = form.professor_id;
        payload.modalidade_nome = form.modalidade_nome;
      }
      if (!isVisitante) payload.ciclo_id = cobertura.cicloIdParaLigar;

      const resultado = await financeiroService.adicionarPagamentoManual(payload);

      // Toast contextual de sucesso
      const nomeExibicao = isVisitante ? form.nome_visitante : nomeAluno;

      showToast.success(resultado?._ciclo
        ? `✅ Pagamento de ${nomeExibicao} registrado, cobrindo os ${resultado._ciclo.meses} meses do ciclo!`
        : `✅ Pagamento de ${nomeExibicao} registrado com sucesso!`);

      // Avisos em toasts separados — não substituem a confirmação de sucesso
      const avisosRepasse = resultado._avisosRepasse
        ?? (resultado._avisoRepasse ? [resultado._avisoRepasse] : []);
      avisosRepasse.forEach((aviso, i) => {
        setTimeout(() => showToast.warning(`⚠️ ${aviso}`), 600 * (i + 1));
      });

      invalidarConsultasFinanceiras(queryClient);
      onSucesso?.();
      onClose();
    } catch (error) {
      // A mensalidade a quitar mudou em outra tela (já paga, por exemplo):
      // recarrega as consultas para a linha velha sair da tela.
      if (quitando && (error instanceof ErroLancamento || error?.code === 'P0001')) {
        invalidarConsultasFinanceiras(queryClient);
      }
      showToast.error(error instanceof ErroLancamento ? mensagemErroLancamento(error) : traduzirErroRegistro(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal aberto={isOpen} fechar={onClose} title="Novo lançamento" size="md">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        {/* Já foi pago ou fica em aberto — só para aluno cadastrado */}
        {!isVisitante && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { valor: false, rotulo: 'Já foi pago' },
              { valor: true, rotulo: 'Fica em aberto' },
            ].map(op => (
              <button
                key={op.rotulo}
                type="button"
                onClick={() => setEmAberto(op.valor)}
                aria-pressed={emAberto === op.valor}
                className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                  emAberto === op.valor
                    ? 'bg-primary text-white border-primary'
                    : 'bg-card text-foreground/70 border-border hover:bg-muted'
                }`}
              >
                {op.rotulo}
              </button>
            ))}
          </div>
        )}

        {/* Bloco Aluno / Visitante */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <Label>{isVisitante ? 'Nome do Visitante' : 'Selecionar Aluno'}</Label>
            {!alunoFixo && (
              <button
                type="button"
                onClick={() => {
                  setIsVisitante(!isVisitante);
                  setEmAberto(false);
                }}
                className="text-primary font-bold text-xs uppercase tracking-wider hover:underline flex items-center gap-1 transition-colors"
              >
                {isVisitante ? 'Buscar Cadastrado' : 'Registrar Visitante'}
              </button>
            )}
          </div>
          {alunoFixo ? (
            <Input
              leftIcon={<User size={18} />}
              value={alunoFixo.nome_completo || ''}
              readOnly
            />
          ) : isVisitante ? (
            <Input
              leftIcon={<User size={18} />}
              placeholder="Ex: João Silva"
              value={form.nome_visitante}
              onChange={e => setForm({ ...form, nome_visitante: e.target.value })}
              required
            />
          ) : (
            <Input
              as="select"
              leftIcon={<User size={18} />}
              value={form.aluno_id}
              onChange={async e => {
                // O id vem como número da API e como texto do <select>.
                const selectedAluno = alunos.find(a => String(a.id) === e.target.value);
                const defaultPlano = selectedAluno?.plano_id || '';
                const planoObj = planos.find(p => p.id === defaultPlano);
                setForm({
                  ...form,
                  aluno_id: e.target.value,
                  plano_id: defaultPlano,
                  valor_pago: planoObj ? planoObj.preco : form.valor_pago,
                  modalidade_id: '', // reseta referência ao trocar de aluno
                });
                setPlanoAlunoEscolhido('');
                if (e.target.value) {
                  setModalidadesDoAluno(await financeiroService.listarModalidadesDoAluno(e.target.value));
                } else {
                  setModalidadesDoAluno([]);
                }
              }}
              required
            >
              <option value="">Selecione um aluno...</option>
              {alunos.map(a => (
                <option key={a.id} value={a.id}>{a.nome_completo}</option>
              ))}
            </Input>
          )}
        </div>

        {/* Tipo de Recebimento */}
        <div>
          <Label className="block mb-1.5">Tipo de Recebimento</Label>
          <Input
            as="select"
            leftIcon={<LayoutList size={18} />}
            value={form.tipo_aula}
            onChange={e => setForm({ ...form, tipo_aula: e.target.value })}
          >
            <option value="regular">Mensalidade (Plano Regular)</option>
            <option value="avulsa">Aula Avulsa / Coreografia</option>
            <option value="evento">Evento / Festival</option>
            <option value="produto">Venda de Produto (Água, Camiseta, etc)</option>
          </Input>
        </div>

        {/* Vários planos: a cobrança é de um deles */}
        {precisaEscolherPlano && (
          <div>
            <Label className="block mb-1.5">Plano do aluno</Label>
            <Input
              as="select"
              leftIcon={<Package size={18} />}
              value={planoAlunoId ? String(planoAlunoId) : ''}
              onChange={e => {
                const escolhido = e.target.value;
                setPlanoAlunoEscolhido(escolhido);
                // Escolha ativa da recepção: o plano da cobrança acompanha o do aluno.
                const linha = validosDoAluno.find(p => String(p.id) === escolhido);
                if (linha) {
                  setForm(f => ({ ...f, plano_id: linha.plano_id, valor_pago: linha.planos?.preco ?? f.valor_pago }));
                }
              }}
            >
              <option value="">Selecione o plano...</option>
              {validosDoAluno.map(p => (
                <option key={p.id} value={p.id}>{rotuloPlanoAluno(p, planosDoAluno)}</option>
              ))}
            </Input>
          </div>
        )}

        {/* Mensalidade que este lançamento vai quitar */}
        {form.tipo_aula === 'regular' && !isVisitante && !lancarEmAberto && cobrancasEmAberto.length > 0 && (
          <div className="space-y-2 bg-warning-soft p-4 rounded-2xl border border-warning/20">
            <Label className="block">Mensalidade em aberto deste aluno</Label>
            <Input
              as="select"
              value={cobrancaId}
              onChange={e => handleCobrancaChange(e.target.value)}
              className="bg-card"
            >
              {cobrancasEmAberto.map(c => (
                <option key={c.id} value={c.id}>
                  Venc. {new Date(`${c.data_vencimento}T12:00:00`).toLocaleDateString('pt-BR')} — {formatarMoeda(valorDevidoMensalidade(c))}{c.planos?.nome ? ` — ${c.planos.nome}` : ''}
                </option>
              ))}
              <option value="">Nenhuma — lançar como novo pagamento</option>
            </Input>
            <p className="text-[11px] font-medium text-foreground/80">
              {cobrancaParaQuitar
                ? 'O pagamento será registrado nesta mensalidade, sem criar outra.'
                : 'Será criado um lançamento novo, e as mensalidades acima continuam em aberto.'}
            </p>
          </div>
        )}

        {/* Campos Plano Regular */}
        {form.tipo_aula === 'regular' && !cobrancaParaQuitar && (
          <div>
            <Label className="block mb-1.5">Plano Referente</Label>
            <Input
              as="select"
              leftIcon={<Package size={18} />}
              value={form.plano_id}
              onChange={e => {
                const p = planos.find(pl => String(pl.id) === e.target.value);
                setForm({ ...form, plano_id: e.target.value, valor_pago: p ? p.preco : '' });
              }}
              required
            >
              <option value="">Selecione o plano...</option>
              {planos.map(p => (
                <option key={p.id} value={p.id}>{p.nome} - R$ {p.preco}</option>
              ))}
            </Input>
          </div>
        )}

        {form.tipo_aula === 'regular' && !isVisitante && <CoberturaDoCiclo cobertura={cobertura} />}

        {form.tipo_aula === 'regular' && modalidadesDoAluno.length > 1 && (
          <div>
            <Label className="block mb-1.5">Referência (modalidade)</Label>
            <Input
              as="select"
              leftIcon={<BookOpen size={18} />}
              value={form.modalidade_id}
              onChange={e => setForm({ ...form, modalidade_id: e.target.value })}
            >
              <option value="">Todas as modalidades matriculadas (rateio padrão)</option>
              {modalidadesDoAluno.map(m => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </Input>
          </div>
        )}

        {/* Campos Aula Avulsa */}
        {form.tipo_aula === 'avulsa' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="block mb-1.5">Professor(a)</Label>
              <Input
                as="select"
                leftIcon={<GraduationCap size={18} />}
                value={form.professor_id}
                onChange={e => setForm({ ...form, professor_id: e.target.value })}
                required
              >
                <option value="">Selecione...</option>
                {professores.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </Input>
            </div>
            <div>
              <Label className="block mb-1.5">Modalidade</Label>
              <Input
                leftIcon={<BookOpen size={18} />}
                placeholder="Ex: Dança de Salão"
                value={form.modalidade_nome}
                onChange={e => setForm({ ...form, modalidade_nome: e.target.value })}
                required
              />
            </div>
          </div>
        )}

        {/* Valores e Datas */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="block mb-1.5">{lancarEmAberto ? 'Valor a receber (R$)' : 'Valor Pago (R$)'}</Label>
            <Input
              type="number" step="0.01" min="0"
              leftIcon={<DollarSign size={18} />}
              placeholder="0.00"
              value={form.valor_pago}
              onChange={e => setForm({ ...form, valor_pago: e.target.value })}
              required
            />
          </div>

          {!lancarEmAberto && (
            <div>
              <Label className="block mb-1.5">Data do Pagamento</Label>
              <Input
                type="date"
                leftIcon={<Calendar size={18} />}
                value={form.data_pagamento}
                onChange={e => setForm({ ...form, data_pagamento: e.target.value })}
                required
              />
            </div>
          )}
          {(lancarEmAberto || !cobrancaParaQuitar) && (
            <div>
              <Label className="block mb-1.5">Data do Vencimento</Label>
              <Input
                type="date"
                leftIcon={<Calendar size={18} />}
                value={form.data_vencimento}
                onChange={e => setForm({ ...form, data_vencimento: e.target.value })}
                required
              />
            </div>
          )}
        </div>

        {!lancarEmAberto && (
          <div>
            <Label className="block mb-1.5">Forma de Pagamento</Label>
            <Input
              as="select"
              leftIcon={<CreditCard size={18} />}
              value={form.forma_pagamento}
              onChange={e => setForm({ ...form, forma_pagamento: e.target.value })}
            >
              <option value="pix">Pix</option>
              <option value="credito">Cartão de Crédito</option>
              <option value="debito">Cartão de Débito</option>
              <option value="dinheiro">Dinheiro</option>
            </Input>
          </div>
        )}

        <div className="pt-4">
          <Button
            type="submit"
            variant="brand"
            size="lg"
            fullWidth
            loading={loading}
            disabled={bloqueadoPorPlanos}
          >
            {loading ? (
              <><Loader2 className="animate-spin" size={20} /> Registrando...</>
            ) : (
              lancarEmAberto ? 'Lançar em aberto' : 'Registrar Recebimento'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}