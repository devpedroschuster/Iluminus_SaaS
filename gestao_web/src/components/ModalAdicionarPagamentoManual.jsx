import React, { useState, useEffect } from 'react';
import Modal from './shared/Modal';
import { supabase } from '../lib/supabase';
import { financeiroService } from '../services/financeiroService';
import { showToast } from './shared/Toast';
import { User, DollarSign, Calendar, BookOpen, GraduationCap } from 'lucide-react';

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} titulo="Novo Lançamento Financeiro">
      <form onSubmit={handleSubmit} className="space-y-4">
        
        {/* Aluno / Visitante */}
        <div className="animate-in fade-in">
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <User size={16}/> {isVisitante ? 'Nome do Visitante' : 'Aluno Matriculado'}
            </label>
            <button 
              type="button" 
              onClick={() => setIsVisitante(!isVisitante)}
              className="text-[10px] font-black text-iluminus-terracota hover:underline uppercase tracking-wider bg-orange-50 px-2 py-1 rounded-md transition-colors"
            >
              {isVisitante ? 'Selecionar Aluno da Casa' : 'Visitante / Sem Cadastro'}
            </button>
          </div>

          {!isVisitante ? (
            <select 
              required={!isVisitante} 
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
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
              className="w-full border border-gray-300 p-3 rounded-xl outline-none focus:border-iluminus-terracota"
              value={form.nome_visitante} 
              onChange={e => setForm({...form, nome_visitante: e.target.value, aluno_id: ''})}
            />
          )}
        </div>

        {/* Tipo Aula e Valor */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Tipo</label>
            <select 
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
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
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
              <DollarSign size={16}/> Valor Pago
            </label>
            <input 
              type="number" step="0.01" required
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
              value={form.valor_pago} onChange={e => setForm({...form, valor_pago: e.target.value})}
            />
          </div>
        </div>

        {/* Plano Normal */}
        {form.tipo_aula === 'regular' && (
          <div className="animate-in fade-in">
            <label className="block text-sm font-bold text-gray-700 mb-1">Vincular ao Plano</label>
            <select 
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
              value={form.plano_id} onChange={e => setForm({...form, plano_id: e.target.value})}
            >
              <option value="">Selecione o plano...</option>
              {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}

        {/* Avulsa ou Experimental */}
        {(form.tipo_aula === 'avulsa' || form.tipo_aula === 'experimental') && (
          <div className="grid grid-cols-2 gap-4 animate-in fade-in">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                <GraduationCap size={16}/> Professor
              </label>
              <select 
                required className="w-full border border-gray-300 p-3 rounded-xl outline-none"
                value={form.professor_id} onChange={e => setForm({...form, professor_id: e.target.value})}
              >
                <option value="">Selecione...</option>
                {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                <BookOpen size={16}/> Modalidade
              </label>
              <input 
                type="text" placeholder="Ex: Hip Hop" required
                className="w-full border border-gray-300 p-3 rounded-xl outline-none"
                value={form.modalidade_nome} onChange={e => setForm({...form, modalidade_nome: e.target.value})}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
              <Calendar size={16}/> Data
            </label>
            <input 
              type="date" className="w-full border border-gray-300 p-3 rounded-xl outline-none"
              value={form.data_vencimento} onChange={e => setForm({...form, data_vencimento: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Forma de Pagamento</label>
            <select 
              className="w-full border border-gray-300 p-3 rounded-xl outline-none"
              value={form.forma_pagamento} onChange={e => setForm({...form, forma_pagamento: e.target.value})}
            >
              <option value="pix">Pix</option>
              <option value="credito">Cartão de Crédito</option>
              <option value="debito">Cartão de Débito</option>
              <option value="dinheiro">Dinheiro</option>
            </select>
          </div>
        </div>

        <button 
          type="submit" disabled={loading}
          className="w-full bg-iluminus-terracota text-white py-4 rounded-xl font-black text-lg mt-4 disabled:opacity-50"
        >
          {loading ? 'Processando...' : 'Confirmar Lançamento'}
        </button>
      </form>
    </Modal>
  );
}