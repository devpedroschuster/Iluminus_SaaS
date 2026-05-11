import React, { useState, useEffect } from 'react';
import Modal from './shared/Modal';
import { supabase } from '../lib/supabase';
import { alunosService } from '../services/alunosService';
import { showToast } from './shared/Toast';
// Adicionado Loader2
import { Package, Calendar, DollarSign, Loader2 } from 'lucide-react';

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

  const calcularDataFim = (dataInicioStr, mesesAdicionais) => {
    if (!dataInicioStr || !mesesAdicionais) return '';
    const d = new Date(dataInicioStr + 'T12:00:00');
    d.setDate(d.getDate() + (mesesAdicionais * 30)); 
    return d.toISOString().split('T')[0];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const planoInfos = planos.find(p => String(p.id) === String(form.plano_id));
      const duracao = planoInfos?.duracao_meses || 1;
      
      const novaDataFim = calcularDataFim(form.data_inicio, duracao);

      await alunosService.renovarPlano(alunoId, {
        ...form,
        data_fim: novaDataFim
      });

      showToast.success('Plano renovado e histórico atualizado!');
      onSucesso?.();
      onClose();
    } catch (error) {
      console.error(error);
      showToast.error('Erro ao renovar plano');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-iluminus-terracota/20 outline-none transition-all text-gray-700 dark:text-zinc-200";
  const labelClass = "block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-1";
  const iconClass = "absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500";

  return (
   <Modal isOpen={isOpen} onClose={onClose} titulo="Renovar / Alterar Plano">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Selecione o Novo Plano</label>
          <div className="relative">
            <Package className={iconClass} size={18} />
            <select 
              required className={inputClass}
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
              {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Início</label>
            <div className="relative">
              <Calendar className={iconClass} size={18} />
              <input type="date" required className={inputClass} value={form.data_inicio}
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
          </div>
          <div>
            <label className={labelClass}>Vencimento</label>
            <div className="relative">
              <Calendar className={iconClass} size={18} />
              <input type="date" required className={inputClass} value={form.data_fim}
              onChange={e => setForm({...form, data_fim: e.target.value})}
            />
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass}>Valor Negociado (R$)</label>
          <div className="relative">
            <DollarSign className={iconClass} size={18} />
            <input type="number" step="0.01" required className={inputClass} value={form.valor_pago}
            onChange={e => setForm({...form, valor_pago: e.target.value})}
          />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="px-6 py-3 font-bold text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-all">Cancelar</button>
          
          {/* Botão com Feedback Visual Atualizado */}
          <button type="submit" disabled={loading} className="px-6 py-3 font-bold bg-iluminus-terracota text-white rounded-xl hover:brightness-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="animate-spin" size={20} /> Salvando...</> : 'Confirmar Renovação'}
          </button>
        </div>
      </form>
    </Modal>
  );
}