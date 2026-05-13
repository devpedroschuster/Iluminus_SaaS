import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { alunosService } from '../services/alunosService';
import { showToast } from './shared/Toast';
import { Package, Calendar, DollarSign, Loader2 } from 'lucide-react';

import Modal from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';

export default function ModalRenovarPlano({ isOpen, onClose, alunoId, onSucesso }) {
  const [planos, setPlanos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    plano_id: '',
    data_inicio: new Date().toISOString().split('T')[0], 
    data_fim: '',
    valor_pago: ''
  });

  useEffect(() => {
    if (isOpen && alunoId) {
      supabase.from('planos').select('id, nome, preco, duracao_meses').order('preco').then(({ data }) => {
        if (data) setPlanos(data);
      });

      supabase.from('alunos').select('data_fim_plano').eq('id', alunoId).single().then(({ data }) => {
        if (data && data.data_fim_plano) {
          setForm(prev => ({ ...prev, data_inicio: data.data_fim_plano }));
        }
      });
    }
  }, [isOpen, alunoId]);

  const calcularDataFim = (dataInicioStr, meses) => {
    const data = new Date(dataInicioStr + 'T12:00:00');
    data.setMonth(data.getMonth() + meses);
    return data.toISOString().split('T')[0];
  };

  const handlePlanoChange = (e) => {
    const planoId = e.target.value;
    const planoSelecionado = planos.find(p => p.id === planoId);
    
    if (planoSelecionado) {
      setForm({
        ...form,
        plano_id: planoId,
        valor_pago: planoSelecionado.preco,
        data_fim: calcularDataFim(form.data_inicio, planoSelecionado.duracao_meses)
      });
    } else {
      setForm({ ...form, plano_id: planoId, valor_pago: '', data_fim: '' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await alunosService.renovarPlano(alunoId, {
        plano_id: form.plano_id,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        valor_pago: form.valor_pago
      });
      showToast.success("Plano renovado com sucesso!");
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error("Erro ao renovar plano: " + error.message);
    } finally {
      setLoading(false);
    }
  };

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
                const planoSelecionado = planos.find(p => p.id === form.plano_id);
                setForm({
                  ...form, 
                  data_inicio: novaDataInicio,
                  data_fim: planoSelecionado ? calcularDataFim(novaDataInicio, planoSelecionado.duracao_meses) : form.data_fim
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
          <Label className="block mb-1.5">Valor Negociado (R$)</Label>
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
    </Modal>
  );
}