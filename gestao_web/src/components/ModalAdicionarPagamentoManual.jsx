import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';
import { supabase } from '../lib/supabase';
import { financeiroService } from '../services/financeiroService';
import { showToast } from './shared/Toast';
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
    const { data: a } = await supabase.from('alunos').select('id, nome_completo, plano_id').order('nome_completo');
    const { data: p } = await supabase.from('planos').select('id, nome, preco');
    const { data: profs } = await supabase.from('professores').select('id, nome');
    
    if (a) setAlunos(a);
    if (p) setPlanos(p);
    if (profs) setProfessores(profs);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        aluno_id: isVisitante ? null : form.aluno_id,
        nome_visitante: isVisitante ? form.nome_visitante : null,
        tipo_aula: form.tipo_aula,
        valor_pago: Number(form.valor_pago),
        forma_pagamento: form.forma_pagamento,
        data_vencimento: form.data_vencimento,
        status: 'pago',
        data_pagamento: new Date().toISOString().split('T')[0]
      };

      if (form.tipo_aula === 'regular' && form.plano_id) {
        payload.plano_id = form.plano_id;
      }

      if (form.tipo_aula === 'avulsa') {
        payload.professor_id = form.professor_id;
        payload.modalidade_nome = form.modalidade_nome;
      }

      await financeiroService.adicionarPagamentoManual(payload);
      showToast.success("Recebimento registrado com sucesso!");
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error("Erro ao registrar: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal aberto={isOpen} fechar={onClose} title="Registrar Pagamento" size="md">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        
        {/* Bloco Aluno / Visitante */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <Label>{isVisitante ? 'Nome do Visitante' : 'Selecionar Aluno'}</Label>
            <button 
              type="button" 
              onClick={() => setIsVisitante(!isVisitante)}
              className="text-primary font-bold text-xs uppercase tracking-wider hover:underline flex items-center gap-1 transition-colors"
            >
              {isVisitante ? 'Buscar Cadastrado' : 'Registrar Visitante'}
            </button>
          </div>
          
          {isVisitante ? (
            <Input 
              leftIcon={<User size={18} />}
              placeholder="Ex: João Silva"
              value={form.nome_visitante} 
              onChange={e => setForm({...form, nome_visitante: e.target.value})}
              required
            />
          ) : (
            <Input 
              as="select"
              leftIcon={<User size={18} />}
              value={form.aluno_id} 
              onChange={e => {
                const selectedAluno = alunos.find(a => a.id === e.target.value);
                const defaultPlano = selectedAluno?.plano_id || '';
                const planoObj = planos.find(p => p.id === defaultPlano);
                
                setForm({
                  ...form, 
                  aluno_id: e.target.value,
                  plano_id: defaultPlano,
                  valor_pago: planoObj ? planoObj.valor_mensal : form.valor_pago
                });
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
            onChange={e => setForm({...form, tipo_aula: e.target.value})}
          >
            <option value="regular">Mensalidade (Plano Regular)</option>
            <option value="avulsa">Aula Avulsa / Coreografia</option>
            <option value="evento">Evento / Festival</option>
            <option value="produto">Venda de Produto (Água, Camiseta, etc)</option>
          </Input>
        </div>

        {/* Campos Plano Regular */}
        {form.tipo_aula === 'regular' && (
          <div>
            <Label className="block mb-1.5">Plano Referente</Label>
            <Input 
              as="select"
              leftIcon={<Package size={18} />}
              value={form.plano_id} 
              onChange={e => {
                const p = planos.find(pl => pl.id === e.target.value);
                setForm({...form, plano_id: e.target.value, valor_pago: p ? p.valor_mensal : ''});
              }}
              required
            >
              <option value="">Selecione o plano...</option>
              {planos.map(p => (
                <option key={p.id} value={p.id}>{p.nome} - R$ {p.valor_mensal}</option>
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
                onChange={e => setForm({...form, professor_id: e.target.value})}
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
                onChange={e => setForm({...form, modalidade_nome: e.target.value})}
                required
              />
            </div>
          </div>
        )}

        {/* Valores e Datas */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="block mb-1.5">Valor Pago (R$)</Label>
            <Input 
              type="number" step="0.01" min="0"
              leftIcon={<DollarSign size={18} />}
              placeholder="0.00"
              value={form.valor_pago} 
              onChange={e => setForm({...form, valor_pago: e.target.value})}
              required
            />
          </div>
          <div>
            <Label className="block mb-1.5">Data do Vencimento</Label>
            <Input 
              type="date"
              leftIcon={<Calendar size={18} />}
              value={form.data_vencimento} 
              onChange={e => setForm({...form, data_vencimento: e.target.value})}
              required
            />
          </div>
        </div>

        <div>
          <Label className="block mb-1.5">Forma de Pagamento</Label>
          <Input 
            as="select"
            leftIcon={<CreditCard size={18} />}
            value={form.forma_pagamento} 
            onChange={e => setForm({...form, forma_pagamento: e.target.value})}
          >
            <option value="pix">Pix</option>
            <option value="credito">Cartão de Crédito</option>
            <option value="debito">Cartão de Débito</option>
            <option value="dinheiro">Dinheiro</option>
          </Input>
        </div>

        <div className="pt-4">
          <Button 
            type="submit" 
            variant="brand" 
            size="lg" 
            fullWidth 
            loading={loading}
          >
            {loading ? (
              <><Loader2 className="animate-spin" size={20} /> Registrando...</>
            ) : (
              'Registrar Recebimento'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}