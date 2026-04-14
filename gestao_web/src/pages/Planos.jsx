import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Package, RefreshCw, Calendar, Edit2 } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';
import Modal from '../components/shared/Modal';

export default function Planos() {
  const [planos, setPlanos] = useState([]);
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  // ESTADO DE CRIAÇÃO
  const [novoPlano, setNovoPlano] = useState({ 
    nome: '', preco: '', frequencia_semanal: ''
  });

  // ESTADOS DE EDIÇÃO
  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [planoEmEdicao, setPlanoEmEdicao] = useState(null);

  useEffect(() => { fetchPlanos(); }, []);

  async function fetchPlanos() {
    const { data } = await supabase.from('planos').select('*').order('id', { ascending: true });
    if (data) setPlanos(data);
    setLoadingList(false);
  }

  async function handleCriarPlano(e) {
    e.preventDefault();
    if (creating) return; 
    setCreating(true);    

    try {
        const payload = {
          nome: novoPlano.nome,
          preco: novoPlano.preco,
          frequencia_semanal: novoPlano.frequencia_semanal
        };

        const { error } = await supabase.from('planos').insert([payload]);
        if (error) throw error;
        
        showToast.success("Plano criado com sucesso!");
        setNovoPlano({ nome: '', preco: '', frequencia_semanal: '' });
        fetchPlanos();
    } catch (err) {
        showToast.error("Erro ao criar plano.");
    } finally {
        setCreating(false); 
    }
  }

  async function excluirPlano(id) {
    if (!confirm("Tem certeza que deseja remover este plano?")) return;
    setDeletingId(id); 
    try {
        await supabase.from('planos').delete().eq('id', id);
        showToast.success("Plano removido.");
        fetchPlanos();
    } catch (err) {
        showToast.error("Erro ao excluir. Verifique se há alunos vinculados a ele.");
    } finally {
        setDeletingId(null);
    }
  }

  function abrirEdicao(plano) {
    setPlanoEmEdicao({ ...plano });
    setModalEdicaoAberto(true);
  }

  async function handleSalvarEdicao(e) {
    e.preventDefault();
    if (savingEdit) return;
    setSavingEdit(true);

    try {
      const payload = {
        nome: planoEmEdicao.nome,
        preco: planoEmEdicao.preco,
        frequencia_semanal: planoEmEdicao.frequencia_semanal
      };

      const { error } = await supabase.from('planos').update(payload).eq('id', planoEmEdicao.id);
      if (error) throw error;

      showToast.success("Plano atualizado com sucesso!");
      setModalEdicaoAberto(false);
      fetchPlanos();
    } catch (err) {
      showToast.error("Erro ao atualizar plano.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
       <div>
          <h1 className="text-3xl font-black text-gray-800">Planos e Mensalidades</h1>
          <p className="text-gray-500">Cadastre e edite os pacotes comerciais vendidos no estúdio.</p>
       </div>

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2"><Package size={20}/> Criar Novo Plano</h3>
        
        <form onSubmit={handleCriarPlano} className="flex flex-wrap md:flex-nowrap gap-4 items-end">
          <div className="flex-1 min-w-[200px] w-full">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome do Plano</label>
            <input 
              required placeholder="Ex: Combo: 2 Danças + 2 Funcional"
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-colors" 
              value={novoPlano.nome} onChange={e => setNovoPlano({...novoPlano, nome: e.target.value})} 
            />
          </div>
          
          <div className="w-full md:w-40">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Preço (R$)</label>
            <input 
              required type="number" step="0.01" placeholder="0.00"
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-colors" 
              value={novoPlano.preco} onChange={e => setNovoPlano({...novoPlano, preco: e.target.value})} 
            />
          </div>

          <div className="w-full md:w-40">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Rótulo (Freq.)</label>
            <input 
              required placeholder="Ex: 4x sem."
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-colors" 
              value={novoPlano.frequencia_semanal} onChange={e => setNovoPlano({...novoPlano, frequencia_semanal: e.target.value})} 
            />
          </div>

          <button disabled={creating} className="bg-iluminus-terracota text-white px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-lg shadow-orange-100 disabled:opacity-70 transition-all hover:scale-[1.02] w-full md:w-auto mt-4 md:mt-0">
            {creating ? <RefreshCw className="animate-spin" size={24}/> : <Plus size={24}/>}
            {creating ? "Salvando..." : "Salvar Plano"}
          </button>
        </form>
      </div>

      {/* GRADE DE PLANOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingList ? (
           [1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-3xl animate-pulse" />)
        ) : planos.map(plano => (
          <div key={plano.id} className="bg-white p-6 rounded-3xl border border-gray-100 flex justify-between items-center shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center gap-4">
               <div className="bg-orange-50 p-4 rounded-2xl text-iluminus-terracota"><Package size={24}/></div>
               <div>
                 <h3 className="font-black text-lg text-gray-800 leading-tight">{plano.nome}</h3>
                 <div className="flex items-center gap-2 text-sm font-medium text-gray-400 mt-1">
                    <span className="text-green-600 font-black">R$ {plano.preco}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span className="flex items-center gap-1"><Calendar size={12}/> {plano.frequencia_semanal}</span>
                 </div>
               </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => abrirEdicao(plano)} className="p-3 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Editar Plano">
                    <Edit2 size={18}/>
                </button>
                <button onClick={() => excluirPlano(plano.id)} disabled={deletingId === plano.id} className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Excluir Plano">
                    {deletingId === plano.id ? <RefreshCw className="animate-spin text-red-500" size={18}/> : <Trash2 size={18}/>}
                </button>
            </div>
          </div>
        ))}
      </div>

      {/* MODAL DE EDIÇÃO */}
      <Modal isOpen={modalEdicaoAberto} onClose={() => setModalEdicaoAberto(false)} titulo="Editar Pacote / Plano">
        {planoEmEdicao && (
          <form onSubmit={handleSalvarEdicao} className="space-y-6 pt-4">
            
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Nome Comercial do Plano</label>
              <input 
                required className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-transparent transition-colors" 
                value={planoEmEdicao.nome} onChange={e => setPlanoEmEdicao({...planoEmEdicao, nome: e.target.value})} 
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Preço de Venda (R$)</label>
                <input 
                  required type="number" step="0.01" className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-green-600 focus:border-blue-300 border border-transparent transition-colors" 
                  value={planoEmEdicao.preco} onChange={e => setPlanoEmEdicao({...planoEmEdicao, preco: e.target.value})} 
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Rótulo de Frequência</label>
                <input 
                  required className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-transparent transition-colors" 
                  value={planoEmEdicao.frequencia_semanal} onChange={e => setPlanoEmEdicao({...planoEmEdicao, frequencia_semanal: e.target.value})} 
                />
              </div>
            </div>

            <button disabled={savingEdit} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-100 hover:scale-[1.02] transition-all disabled:opacity-50">
              {savingEdit ? <RefreshCw className="animate-spin" size={20}/> : "Atualizar Plano"}
            </button>
          </form>
        )}
      </Modal>

    </div>
  );
}