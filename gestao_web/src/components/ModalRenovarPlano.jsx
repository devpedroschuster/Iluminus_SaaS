import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { alunosService } from '../services/alunosService';
import { showToast } from './shared/showToast';
import { Package, Calendar, DollarSign, Loader2 } from 'lucide-react';
import { formatarMoeda, hojeBrasilia, calcularFimPlano } from '../lib/utils';

import Modal, { ModalConfirmacao } from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';

export default function ModalRenovarPlano({ isOpen, onClose, alunoId, onSucesso }) {
  const [planos, setPlanos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmandoValor, setConfirmandoValor] = useState(false);
  const [form, setForm] = useState({
    plano_id: '',
    data_inicio: hojeBrasilia(),
    data_fim: '',
    valor_pago: '',
    forma_recebimento: 'recorrente'
  });

  // Valor total quando o ciclo é pago de uma vez (preço mensal × duração) —
  // mesma conta usada no servidor (renovar_plano_aluno), sem desconto.
  const calcularValorAVista = (planoSelecionado) =>
    planoSelecionado ? Number(planoSelecionado.preco) * (planoSelecionado.duracao_meses || 1) : '';

  useEffect(() => {
    if (isOpen && alunoId) {
      supabase.from('planos').select('id, nome, preco, duracao_meses').order('preco').then(({ data, error }) => {
        if (error) {
          console.error('[ModalRenovarPlano] Erro ao carregar planos:', error);
          showToast.error('Erro ao carregar planos disponíveis. Tente reabrir o modal.');
          return;
        }
        if (data) setPlanos(data);
      });

      supabase.from('alunos').select('data_fim_plano').eq('id', alunoId).single().then(({ data, error }) => {
        if (error) {
          // Não bloqueia o fluxo: o campo data_inicio já tem um valor padrão (hoje).
          // Mas o usuário precisa saber que a data pré-preenchida pode não refletir
          // o vencimento real do plano atual.
          console.error('[ModalRenovarPlano] Erro ao carregar data_fim_plano do aluno:', error);
          showToast.error('Não foi possível carregar a data de término do plano atual. Confira a data de início manualmente.');
          return;
        }
        if (data && data.data_fim_plano) {
          // Novo ciclo começa no dia seguinte ao fim do anterior — reaproveitar
          // o mesmo dia (sem +1) sobrepunha 1 dia entre os dois ciclos.
          const proximoDia = new Date(data.data_fim_plano + 'T12:00:00');
          proximoDia.setDate(proximoDia.getDate() + 1);
          setForm(prev => ({ ...prev, data_inicio: proximoDia.toISOString().split('T')[0] }));
        }
      });
    }
  }, [isOpen, alunoId]);

  const handlePlanoChange = (e) => {
  const planoId = e.target.value;
  const planoSelecionado = planos.find(p => p.id === Number(planoId));

    if (planoSelecionado) {
    setForm({
      ...form,
      plano_id: planoId,
      valor_pago: form.forma_recebimento === 'a_vista'
        ? calcularValorAVista(planoSelecionado)
        : planoSelecionado.preco,
      data_fim: calcularFimPlano(form.data_inicio, planoSelecionado.duracao_meses)
    });
  } else {
    setForm({ ...form, plano_id: planoId, valor_pago: '', data_fim: '' });
  }
};

  const handleFormaRecebimentoChange = (formaRecebimento) => {
    const planoSelecionado = planos.find(p => p.id === Number(form.plano_id));
    setForm({
      ...form,
      forma_recebimento: formaRecebimento,
      valor_pago: planoSelecionado
        ? (formaRecebimento === 'a_vista' ? calcularValorAVista(planoSelecionado) : planoSelecionado.preco)
        : form.valor_pago
    });
  };

  async function executarRenovacao() {
    setLoading(true);
    try {
      await alunosService.renovarPlano(alunoId, {
        plano_id: form.plano_id,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        valor_pago: form.valor_pago,
        forma_recebimento: form.forma_recebimento
      });
      showToast.success("Plano renovado com sucesso!");
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error("Erro ao renovar plano: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault();

    // ILU-33: confirma quando o valor negociado desviar >20% do preço de
    // tabela do plano — evita que um erro de digitação vire permanentemente
    // o valor cobrado e a base de cálculo de comissão, sem nenhum aviso.
    const planoSelecionado = planos.find(p => p.id === Number(form.plano_id));
    const precoTabela = form.forma_recebimento === 'a_vista'
      ? Number(calcularValorAVista(planoSelecionado))
      : Number(planoSelecionado?.preco);
    const valorInformado = Number(form.valor_pago);
    const desviaSignificativamente =
      Number.isFinite(precoTabela) && precoTabela > 0
      && Number.isFinite(valorInformado)
      && Math.abs(valorInformado - precoTabela) / precoTabela > 0.2;

    if (desviaSignificativamente) {
      setConfirmandoValor(true);
      return;
    }

    executarRenovacao();
  };

  const confirmarValorEEnviar = () => {
    setConfirmandoValor(false);
    return executarRenovacao();
  };

  const planoSelecionadoAtual = planos.find(p => p.id === Number(form.plano_id));

  return (
    <Modal aberto={isOpen} fechar={onClose} title="Renovar Plano do Aluno" size="md">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        
        <div>
          <Label className="block mb-1.5">Selecionar Novo Plano</Label>
          <Input 
            as="select" 
            leftIcon={<Package size={18} />}
            value={form.plano_id} 
            onChange={handlePlanoChange}
            required
          >
            <option value="">Selecione o plano...</option>
            {planos.map(p => (
              <option key={p.id} value={p.id}>{p.nome} - R$ {p.preco}</option>
            ))}
          </Input>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="block mb-1.5">Data de Início</Label>
            <Input 
              type="date" 
              leftIcon={<Calendar size={18} />}
              value={form.data_inicio}
              onChange={e => {
  const novaDataInicio = e.target.value;
  const planoSelecionado = planos.find(p => p.id === Number(form.plano_id)); // ← cast corrigido
  setForm({
    ...form,
    data_inicio: novaDataInicio,
    data_fim: planoSelecionado
      ? calcularFimPlano(novaDataInicio, planoSelecionado.duracao_meses)
      : form.data_fim
  });
}}
              required
            />
          </div>
          <div>
            <Label className="block mb-1.5">Data de Vencimento</Label>
            <Input 
              type="date" 
              leftIcon={<Calendar size={18} />}
              value={form.data_fim}
              onChange={e => setForm({...form, data_fim: e.target.value})}
              required
            />
          </div>
        </div>

        <div>
          <Label className="block mb-1.5">Forma de Recebimento</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleFormaRecebimentoChange('recorrente')}
              className={`py-2.5 rounded-xl border font-bold text-sm transition-colors ${
                form.forma_recebimento === 'recorrente'
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              Recorrente (mensal)
            </button>
            <button
              type="button"
              onClick={() => handleFormaRecebimentoChange('a_vista')}
              className={`py-2.5 rounded-xl border font-bold text-sm transition-colors ${
                form.forma_recebimento === 'a_vista'
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              À vista
            </button>
          </div>
        </div>

        <div>
          <Label className="block mb-1.5">
            {form.forma_recebimento === 'a_vista' ? 'Valor Total à Vista (R$)' : 'Valor Negociado (R$)'}
          </Label>
          <Input 
            type="number" 
            step="0.01" 
            leftIcon={<DollarSign size={18} />}
            value={form.valor_pago}
            onChange={e => setForm({...form, valor_pago: e.target.value})}
            required
          />
        </div>

        <Modal.Footer>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          
          <Button 
            type="submit" 
            variant="brand" 
            loading={loading}
          >
            {loading ? (
              <><Loader2 className="animate-spin" size={20} /> Processando...</>
            ) : (
              'Confirmar Renovação'
            )}
          </Button>
        </Modal.Footer>
      </form>

      <ModalConfirmacao
        isOpen={confirmandoValor}
        onClose={() => setConfirmandoValor(false)}
        onConfirm={confirmarValorEEnviar}
        tipo="warning"
        titulo="Confirmar valor fora do padrão"
        mensagem={`O valor negociado (${formatarMoeda(form.valor_pago)}) difere em mais de 20% do preço de tabela do plano ${planoSelecionadoAtual ? `(${formatarMoeda(planoSelecionadoAtual.preco)})` : ''}. Confirma a renovação com este valor?`}
        textoConfirmar="Confirmar valor"
        loading={loading}
      />
    </Modal>
  );
}