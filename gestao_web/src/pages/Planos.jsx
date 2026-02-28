import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Package, RefreshCw, Calendar } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';

export default function Planos() {
  const [planos, setPlanos] = useState([]);
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  const [novoPlano, setNovoPlano] = useState({ nome: '', preco: '', frequencia_semanal: '' });

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
        const { error } = await supabase.from('planos').insert([novoPlano]);
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
        showToast.error("Erro ao excluir. Verifique se há alunos vinculados.");
    } finally {
        setDeletingId(null);
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
       <div>
          <h1 className="text-3xl font-black text-gray-800">Planos</h1>
          <p className="text-gray-500">Configure os pacotes de aulas e preços.</p>
       </div>

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-4">Novo Plano</h3>
        <form onSubmit={handleCriarPlano} className="flex flex-wrap gap-4 items-end">
          
          {/* Campo Nome */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome do Plano</label>
            <input 
              required 
              placeholder="Ex: Mensal 2x"
              className="w-full p-3 bg-gray-50 rounded-xl outline-none font-bold text-gray-700" 
              value={novoPlano.nome} 
              onChange={e => setNovoPlano({...novoPlano, nome: e.target.value})} 
            />
          </div>
          
          {/* Campo Frequência (Restaurado) */}
          <div className="w-32">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Freq. Semanal</label>
            <input 
              required 
              type="number" 
              placeholder="Qtd."
              className="w-full p-3 bg-gray-50 rounded-xl outline-none font-bold text-gray-700" 
              value={novoPlano.frequencia_semanal} 
              onChange={e => setNovoPlano({...novoPlano, frequencia_semanal: e.target.value})} 
            />
          </div>

          {/* Campo Preço */}
          <div className="w-32">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Preço (R$)</label>
            <input 
              required 
              type="number" 
              placeholder="0,00"
              className="w-full p-3 bg-gray-50 rounded-xl outline-none font-bold text-gray-700" 
              value={novoPlano.preco} 
              onChange={e => setNovoPlano({...novoPlano, preco: e.target.value})} 
            />
          </div>
          
          <button 
            disabled={creating}
            className="bg-iluminus-terracota text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg disabled:opacity-70 transition-all hover:scale-105"
          >
            {creating ? <RefreshCw className="animate-spin" size={20}/> : <Plus size={20}/>}
            {creating ? "Criando..." : "Criar"}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loadingList ? (
           [1,2].map(i => <div key={i} className="h-32 bg-gray-100 rounded-3xl animate-pulse" />)
        ) : planos.map(plano => (
          <div key={plano.id} className="bg-white p-6 rounded-3xl border border-gray-100 flex justify-between items-center shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center gap-4">
               <div className="bg-orange-50 p-3 rounded-2xl text-iluminus-terracota"><Package size={24}/></div>
               <div>
                 <h3 className="font-bold text-lg text-gray-800">{plano.nome}</h3>
                 <div className="flex items-center gap-3 text-sm font-medium text-gray-400">
                    <span>R$ {plano.preco} / mês</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span className="flex items-center gap-1"><Calendar size={12}/> {plano.frequencia_semanal}x sem.</span>
                 </div>
               </div>
            </div>

            <button 
                onClick={() => excluirPlano(plano.id)}
                disabled={deletingId === plano.id}
                className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                title="Excluir Plano"
            >
                {deletingId === plano.id ? <RefreshCw className="animate-spin text-red-500" size={20}/> : <Trash2 size={20}/>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}