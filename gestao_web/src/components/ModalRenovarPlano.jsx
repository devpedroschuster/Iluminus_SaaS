import React, { useState, useEffect } from 'react';
import Modal from './shared/Modal';
import { supabase } from '../lib/supabase';
import { alunosService } from '../services/alunosService';
import { showToast } from './shared/Toast';

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
    if (isOpen) {
      supabase.from('planos').select('id, nome, preco, duracao_meses').order('preco').then(({ data }) => {
        if (data) setPlanos(data);
      });
    }
  }, [isOpen]);

  const calcularDataFim = (dataInicioStr, mesesAdicionais) => {
    if (!dataInicioStr || !mesesAdicionais) return '';
    
    const [ano, mes, dia] = dataInicioStr.split('-');
    
    const dataCalculada = new Date(ano, parseInt(mes) - 1 + parseInt(mesesAdicionais), dia);
    
    return dataCalculada.toISOString().split('T')[0];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await alunosService.renovarPlano(alunoId, form);
      showToast.success("Plano renovado com sucesso!");
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error("Erro ao renovar plano.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titulo="Renovar / Alterar Plano">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Selecione o Novo Plano</label>
          <select 
            required
            className="w-full border border-gray-300 p-3 rounded-xl focus:ring-2 focus:ring-iluminus-terracota outline-none"
            value={form.plano_id}
            onChange={e => {
              const planoSelecionado = planos.find(p => p.id === parseInt(e.target.value));
              
              const novaDataFim = planoSelecionado 
                ? calcularDataFim(form.data_inicio, planoSelecionado.duracao_meses)
                : form.data_fim;

              setForm({ 
                ...form, 
                plano_id: e.target.value,
                valor_pago: planoSelecionado ? planoSelecionado.preco : '',
                data_fim: novaDataFim
              });
            }}
          >
            <option value="">Selecione...</option>
            {planos.map(p => (
              <option key={p.id} value={p.id}>{p.nome} - R$ {p.preco}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Data de Início</label>
            <input 
              type="date" required
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
              value={form.data_inicio}
              onChange={e => {
                const novaDataInicio = e.target.value;
                const planoSelecionado = planos.find(p => p.id === parseInt(form.plano_id));
                
                const novaDataFim = planoSelecionado
                  ? calcularDataFim(novaDataInicio, planoSelecionado.duracao_meses)
                  : form.data_fim;

                setForm({
                  ...form, 
                  data_inicio: novaDataInicio,
                  data_fim: novaDataFim
                });
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Data de Fim (Vencimento)</label>
            <input 
              type="date" required
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
              value={form.data_fim}
              onChange={e => setForm({...form, data_fim: e.target.value})}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Valor Negociado / Pago (R$)</label>
          <input 
            type="number" step="0.01" required
            className="w-full border border-gray-300 p-3 rounded-xl outline-none"
            value={form.valor_pago}
            onChange={e => setForm({...form, valor_pago: e.target.value})}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-all">Cancelar</button>
          <button type="submit" disabled={loading} className="px-6 py-3 font-bold bg-iluminus-terracota text-white rounded-xl hover:brightness-90 transition-all disabled:opacity-50">
            {loading ? 'Salvando...' : 'Confirmar Renovação'}
          </button>
        </div>
      </form>
    </Modal>
  );
}