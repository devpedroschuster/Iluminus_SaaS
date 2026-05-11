import React, { useState, useEffect } from 'react';
import Modal from './shared/Modal';
import { supabase } from '../lib/supabase';
import { financeiroService } from '../services/financeiroService';
import { showToast } from './shared/Toast';
// Adicionado Loader2
import { User, DollarSign, Calendar, BookOpen, GraduationCap, Package, CreditCard, LayoutList, Loader2 } from 'lucide-react';

export default function ModalAdicionarPagamentoManual({ isOpen, onClose, onSucesso }) {
  const [alunos, setAlunos] = useState([]);
  const [planos, setPlanos] = useState([]);
  const [professores, setProfessores] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [isVisitante, setIsVisitante] = useState(false);

  const [form, setForm] = useState({
    aluno_id: '',
    nome_visitante: '', 
    tipo_aula: 'regular',
    plano_id: '',
    valor_pago: '',
    forma_pagamento: 'pix',
    data_vencimento: new Date().toISOString().split('T')[0],
    professor_id: '',
    modalidade_nome: ''
  });

  useEffect(() => {
    if (isOpen) carregarDados();
  }, [isOpen]);

  async function carregarDados() {
    const { data: a } = await supabase.from('alunos').select('id, nome_completo').eq('ativo', true).order('nome_completo');
    const { data: p } = await supabase.from('planos').select('id, nome, preco');
    const { data: profs } = await supabase.from('professores').select('id, nome');
    setAlunos(a || []);
    setPlanos(p || []);
    setProfessores(profs || []);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await financeiroService.adicionarPagamentoManual(form);
      showToast.success('Lançamento realizado com sucesso!');
      onSucesso();
      onClose();
      setForm({ ...form, aluno_id: '', nome_visitante: '', valor_pago: '', modalidade_nome: '' });
      setIsVisitante(false);
    } catch (error) {
      showToast.error('Erro ao realizar lançamento');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-iluminus-terracota/20 outline-none transition-all text-gray-700 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-500";
  const iconClass = "absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 pointer-events-none";

  return (
    <Modal isOpen={isOpen} onClose={onClose} titulo="Novo Lançamento Financeiro">
      <form onSubmit={handleSubmit} className="space-y-5">
        
        <div className="animate-in fade-in">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300">
              {isVisitante ? 'Nome do Visitante' : 'Aluno Matriculado'}
            </label>
            <button 
              type="button" 
              onClick={() => setIsVisitante(!isVisitante)}
              className="text-[10px] font-black text-iluminus-terracota dark:text-orange-400 hover:underline uppercase tracking-wider bg-orange-50 dark:bg-orange-950/30 px-2 py-1 rounded-md transition-colors"
            >
              {isVisitante ? 'Selecionar Aluno da Casa' : 'Visitante / Sem Cadastro'}
            </button>
          </div>

          <div className="relative">
            <User className={iconClass} size={18} />
            {!isVisitante ? (
              <select 
                required={!isVisitante} 
                className={inputClass}
                value={form.aluno_id} 
                onChange={e => setForm({...form, aluno_id: e.target.value, nome_visitante: ''})}
              >
                <option value="">Selecione o aluno...</option>
                {alunos.map(a => <option key={a.id} value={a.id}>{a.nome_completo}</option>)}
              </select>
            ) : (
              <input 
                type="text" 
                required={isVisitante}
                placeholder="Ex: Maria Eduarda (Aula Experimental)"
                className={inputClass}
                value={form.nome_visitante} 
                onChange={e => setForm({...form, nome_visitante: e.target.value, aluno_id: ''})}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">Tipo</label>
            <div className="relative">
              <LayoutList className={iconClass} size={18} />
              <select 
                className={inputClass}
                value={form.tipo_aula} 
                onChange={e => {
                  const tipo = e.target.value;
                  setForm({...form, tipo_aula: tipo, plano_id: tipo === 'regular' ? form.plano_id : ''});
                }}
              >
                <option value="regular">Plano Normal</option>
                <option value="plano_livre">Plano Livre</option>
                <option value="avulsa">Aula Avulsa</option>
                <option value="experimental">Aula Experimental</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">
              Valor Pago
            </label>
            <div className="relative">
              <DollarSign className={iconClass} size={18} />
              <input 
                type="number" step="0.01" required placeholder="0.00"
                className={inputClass}
                value={form.valor_pago} onChange={e => setForm({...form, valor_pago: e.target.value})}
              />
            </div>
          </div>
        </div>

        {form.tipo_aula === 'regular' && (
          <div className="animate-in fade-in">
            <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">Vincular ao Plano</label>
            <div className="relative">
              <Package className={iconClass} size={18} />
              <select 
                className={inputClass}
                value={form.plano_id} onChange={e => setForm({...form, plano_id: e.target.value})}
              >
                <option value="">Selecione o plano...</option>
                {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
        )}

        {(form.tipo_aula === 'avulsa' || form.tipo_aula === 'experimental') && (
          <div className="grid grid-cols-2 gap-4 animate-in fade-in">
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">
                Professor
              </label>
              <div className="relative">
                <GraduationCap className={iconClass} size={18} />
                <select 
                  required className={inputClass}
                  value={form.professor_id} onChange={e => setForm({...form, professor_id: e.target.value})}
                >
                  <option value="">Selecione...</option>
                  {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">
                Modalidade
              </label>
              <div className="relative">
                <BookOpen className={iconClass} size={18} />
                <input 
                  type="text" placeholder="Ex: Hip Hop" required
                  className={inputClass}
                  value={form.modalidade_nome} onChange={e => setForm({...form, modalidade_nome: e.target.value})}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">
              Data de Lançamento
            </label>
            <div className="relative">
              <Calendar className={iconClass} size={18} />
              <input 
                type="date" className={inputClass}
                value={form.data_vencimento} onChange={e => setForm({...form, data_vencimento: e.target.value})}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-2">Forma de Pagamento</label>
            <div className="relative">
              <CreditCard className={iconClass} size={18} />
              <select 
                className={inputClass}
                value={form.forma_pagamento} onChange={e => setForm({...form, forma_pagamento: e.target.value})}
              >
                <option value="pix">Pix</option>
                <option value="credito">Cartão de Crédito</option>
                <option value="debito">Cartão de Débito</option>
                <option value="dinheiro">Dinheiro</option>
              </select>
            </div>
          </div>
        </div>

        {/* Botão com Feedback Visual Atualizado */}
        <button 
          type="submit" disabled={loading}
          className="w-full bg-iluminus-terracota text-white py-4 rounded-xl font-black text-lg mt-2 disabled:opacity-50 hover:brightness-95 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {loading ? <><Loader2 className="animate-spin" size={20} /> Processando...</> : 'Confirmar Lançamento'}
        </button>
      </form>
    </Modal>
  );
}