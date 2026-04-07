import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Package, RefreshCw, Calendar, X, PieChart } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';

export default function Planos() {
  const [planos, setPlanos] = useState([]);
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  const [novoPlano, setNovoPlano] = useState({ 
    nome: '', 
    preco: '', 
    frequencia_semanal: '',
    comissao_professor: '',
    comissao_espaco: '',
    comissao_diretor: ''
  });

  useEffect(() => { fetchPlanos(); }, []);

  async function fetchPlanos() {
    const { data } = await supabase.from('planos').select('*').order('id', { ascending: true });
    if (data) setPlanos(data);
    setLoadingList(false);
  }

  const cp = Number(novoPlano.comissao_professor) || 0;
  const ce = Number(novoPlano.comissao_espaco) || 0;
  const cd = Number(novoPlano.comissao_diretor) || 0;
  const somaComissoes = cp + ce + cd;
  const comissoesValidas = somaComissoes === 100 || somaComissoes === 0;

  async function handleCriarPlano(e) {
    e.preventDefault();
    if (creating || !comissoesValidas) return; 
    setCreating(true);    

    try {
        const payload = {
          nome: novoPlano.nome,
          preco: novoPlano.preco,
          frequencia_semanal: novoPlano.frequencia_semanal,
          comissao_professor: cp,
          comissao_espaco: ce,
          comissao_diretor: cd,
          regras_acesso: []
        };

        const { error } = await supabase.from('planos').insert([payload]);
        if (error) throw error;
        
        showToast.success("Plano criado com sucesso!");
        setNovoPlano({ 
          nome: '', preco: '', frequencia_semanal: '', 
          comissao_professor: '', comissao_espaco: '', comissao_diretor: '' 
        });
        fetchPlanos();
    } catch (err) {
        showToast.error("Erro ao criar plano.");
        console.error(err);
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
          <h1 className="text-3xl font-black text-gray-800">Planos & Comissões</h1>
          <p className="text-gray-500">Configure os pacotes comerciais e as regras de repasse financeiro.</p>
       </div>

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2"><Package size={20}/> Criar Novo Plano</h3>
        
        <form onSubmit={handleCriarPlano} className="space-y-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome do Plano</label>
              <input 
                required placeholder="Ex: Combo: 2 Danças + 2 Funcional"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent" 
                value={novoPlano.nome} onChange={e => setNovoPlano({...novoPlano, nome: e.target.value})} 
              />
            </div>
            
            <div className="w-32">
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Preço (R$)</label>
              <input 
                required type="number" placeholder="0,00"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent" 
                value={novoPlano.preco} onChange={e => setNovoPlano({...novoPlano, preco: e.target.value})} 
              />
            </div>

            <div className="w-40">
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Rótulo (Freq.)</label>
              <input 
                required placeholder="Ex: 4x sem."
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent" 
                value={novoPlano.frequencia_semanal} onChange={e => setNovoPlano({...novoPlano, frequencia_semanal: e.target.value})} 
              />
            </div>
          </div>

          <div className="bg-blue-50/50 p-6 rounded-3xl border border-blue-100/50">
            <h4 className="text-sm font-black text-gray-700 uppercase tracking-wide flex items-center gap-2 mb-4">
              <PieChart size={18} className="text-blue-500"/> Repasse Financeiro (%)
            </h4>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[120px]">
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Professor (%)</label>
                <input 
                  type="number" min="0" max="100" placeholder="Ex: 50"
                  className="w-full p-3 bg-white rounded-xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-gray-100 text-center" 
                  value={novoPlano.comissao_professor} onChange={e => setNovoPlano({...novoPlano, comissao_professor: e.target.value})} 
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Espaço Iluminus (%)</label>
                <input 
                  type="number" min="0" max="100" placeholder="Ex: 35"
                  className="w-full p-3 bg-white rounded-xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-gray-100 text-center" 
                  value={novoPlano.comissao_espaco} onChange={e => setNovoPlano({...novoPlano, comissao_espaco: e.target.value})} 
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Direção (%)</label>
                <input 
                  type="number" min="0" max="100" placeholder="Ex: 15"
                  className="w-full p-3 bg-white rounded-xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-gray-100 text-center" 
                  value={novoPlano.comissao_diretor} onChange={e => setNovoPlano({...novoPlano, comissao_diretor: e.target.value})} 
                />
              </div>
            </div>
            <div className="mt-3 h-4">
              {!comissoesValidas && (
                <p className="text-xs text-red-500 font-bold flex items-center gap-1">
                  <X size={14} /> A soma deve ser exatamente 100% ou 0% (Soma atual: {somaComissoes}%)
                </p>
              )}
            </div>
          </div>

          <button disabled={creating || !comissoesValidas} className="bg-iluminus-terracota text-white px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-lg shadow-orange-100 disabled:opacity-70 disabled:cursor-not-allowed transition-all hover:scale-[1.02] w-full md:w-auto">
            {creating ? <RefreshCw className="animate-spin" size={24}/> : <Plus size={24}/>}
            {creating ? "Salvando Plano..." : "Salvar Plano Definitivo"}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {loadingList ? (
           [1,2].map(i => <div key={i} className="h-40 bg-gray-100 rounded-3xl animate-pulse" />)
        ) : planos.map(plano => (
          <div key={plano.id} className="bg-white p-6 md:p-8 rounded-3xl border border-gray-100 flex justify-between items-start shadow-sm hover:shadow-md transition-all">
            <div className="flex gap-5 w-full">
               <div className="bg-orange-50 p-4 rounded-2xl text-iluminus-terracota h-min"><Package size={28}/></div>
               <div className="w-full">
                 <h3 className="font-black text-xl text-gray-800 mb-1">{plano.nome}</h3>
                 <div className="flex items-center gap-3 text-sm font-medium text-gray-400 mb-4">
                    <span className="text-gray-600 font-bold">R$ {plano.preco}</span>
                    <span className="w-1.5 h-1.5 bg-gray-300 rounded-full"></span>
                    <span className="flex items-center gap-1.5"><Calendar size={14}/> {plano.frequencia_semanal}</span>
                 </div>
                 
                 <div className="flex gap-4 pt-4 border-t border-gray-50">
                   <div className="flex flex-col">
                     <span className="text-[9px] font-black text-gray-400 uppercase">Prof.</span>
                     <span className="text-xs font-bold text-gray-700">{plano.comissao_professor}%</span>
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[9px] font-black text-gray-400 uppercase">Espaço</span>
                     <span className="text-xs font-bold text-gray-700">{plano.comissao_espaco}%</span>
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[9px] font-black text-gray-400 uppercase">Direção</span>
                     <span className="text-xs font-bold text-gray-700">{plano.comissao_diretor}%</span>
                   </div>
                 </div>
               </div>
            </div>

            <button onClick={() => excluirPlano(plano.id)} disabled={deletingId === plano.id} className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all ml-4">
                {deletingId === plano.id ? <RefreshCw className="animate-spin text-red-500" size={20}/> : <Trash2 size={20}/>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}