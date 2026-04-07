import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Activity, RefreshCw, UserCheck, Edit2 } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';
import Modal from '../components/shared/Modal';

export default function Modalidades() {
  const [modalidades, setModalidades] = useState([]);
  const [professores, setProfessores] = useState([]);
  
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  const [novaModalidade, setNovaModalidade] = useState({ 
    nome: '', 
    professor_id: ''
  });

  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [modalidadeEmEdicao, setModalidadeEmEdicao] = useState(null);

  useEffect(() => { 
    fetchDados(); 
  }, []);

  async function fetchDados() {
    try {
      const { data: profs } = await supabase.from('professores').select('id, nome').eq('ativo', true).order('nome');
      if (profs) setProfessores(profs);

      const { data: mods } = await supabase
        .from('modalidades')
        .select(`
          id, 
          nome, 
          professor_id,
          professores (nome)
        `)
        .order('nome');
      if (mods) setModalidades(mods);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      setLoadingList(false);
    }
  }

  async function handleCriarModalidade(e) {
    e.preventDefault();
    if (creating || !novaModalidade.nome) return; 
    setCreating(true);    

    try {
        const payload = {
          nome: novaModalidade.nome,
          professor_id: novaModalidade.professor_id || null 
        };

        const { error } = await supabase.from('modalidades').insert([payload]);
        if (error) throw error;
        
        showToast.success("Modalidade adicionada com sucesso!");
        setNovaModalidade({ nome: '', professor_id: '' });
        fetchDados();
    } catch (err) {
        if (err.code === '23505') {
            showToast.error("Já existe uma modalidade com este nome.");
        } else {
            showToast.error("Erro ao adicionar modalidade.");
        }
    } finally {
        setCreating(false); 
    }
  }

  async function excluirModalidade(id) {
    if (!confirm("Tem certeza que deseja remover esta modalidade?")) return;
    setDeletingId(id); 
    try {
        await supabase.from('modalidades').delete().eq('id', id);
        showToast.success("Modalidade removida.");
        fetchDados();
    } catch (err) {
        showToast.error("Erro ao excluir.");
    } finally {
        setDeletingId(null);
    }
  }

  // FUNÇÕES DE EDIÇÃO
  function abrirEdicao(mod) {
    setModalidadeEmEdicao({
      id: mod.id,
      nome: mod.nome,
      professor_id: mod.professor_id || ''
    });
    setModalEdicaoAberto(true);
  }

  async function handleSalvarEdicao(e) {
    e.preventDefault();
    if (!modalidadeEmEdicao?.nome) return;
    setSavingEdit(true);

    try {
      const { error } = await supabase
        .from('modalidades')
        .update({
          nome: modalidadeEmEdicao.nome,
          professor_id: modalidadeEmEdicao.professor_id || null
        })
        .eq('id', modalidadeEmEdicao.id);

      if (error) throw error;

      showToast.success("Modalidade atualizada com sucesso!");
      setModalEdicaoAberto(false);
      fetchDados(); // Atualiza a lista na tela
    } catch (err) {
      if (err.code === '23505') {
        showToast.error("Já existe uma modalidade com este nome.");
      } else {
        showToast.error("Erro ao atualizar modalidade.");
      }
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
       <div>
          <h1 className="text-3xl font-black text-gray-800">Modalidades</h1>
          <p className="text-gray-500">Cadastre os estilos de aula e vincule o professor responsável para o cálculo automático de comissões.</p>
       </div>

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2"><Activity size={20}/> Adicionar Modalidade</h3>
        
        <form onSubmit={handleCriarModalidade} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome da Modalidade</label>
            <input 
              required placeholder="Ex: Dança Criativa"
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent" 
              value={novaModalidade.nome} onChange={e => setNovaModalidade({...novaModalidade, nome: e.target.value})} 
            />
          </div>
          
          <div className="flex-1 w-full">
            <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Professor Responsável</label>
            <select 
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent cursor-pointer"
              value={novaModalidade.professor_id}
              onChange={e => setNovaModalidade({...novaModalidade, professor_id: e.target.value})}
            >
              <option value="">Selecione um professor (Opcional)</option>
              {professores.map(prof => (
                <option key={prof.id} value={prof.id}>{prof.nome}</option>
              ))}
            </select>
          </div>

          <button disabled={creating} className="bg-iluminus-terracota text-white px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-lg shadow-orange-100 disabled:opacity-70 disabled:cursor-not-allowed transition-all hover:scale-[1.02] w-full md:w-auto">
            {creating ? <RefreshCw className="animate-spin" size={24}/> : <Plus size={24}/>}
            Adicionar
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingList ? (
           [1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-3xl animate-pulse" />)
        ) : modalidades.map(mod => (
          <div key={mod.id} className="bg-white p-5 rounded-3xl border border-gray-100 flex justify-between items-center shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 bg-orange-50 rounded-2xl text-iluminus-terracota flex items-center justify-center">
                 <Activity size={24}/>
               </div>
               <div>
                 <h3 className="font-bold text-gray-800">{mod.nome}</h3>
                 <p className="text-xs font-medium text-gray-400 flex items-center gap-1 mt-1">
                   <UserCheck size={12} className={mod.professores ? "text-green-500" : "text-orange-400"}/>
                   {mod.professores ? mod.professores.nome : 'Sem professor vinculado'}
                 </p>
               </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
              <button onClick={() => abrirEdicao(mod)} className="p-3 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Editar Modalidade">
                <Edit2 size={18}/>
              </button>
              <button onClick={() => excluirModalidade(mod.id)} disabled={deletingId === mod.id} className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Excluir Modalidade">
                  {deletingId === mod.id ? <RefreshCw className="animate-spin text-red-500" size={18}/> : <Trash2 size={18}/>}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* MODAL DE EDIÇÃO */}
      <Modal isOpen={modalEdicaoAberto} onClose={() => setModalEdicaoAberto(false)} titulo="Editar Modalidade">
        {modalidadeEmEdicao && (
          <form onSubmit={handleSalvarEdicao} className="space-y-6 pt-4">
            <div>
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome da Modalidade</label>
              <input 
                required 
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent" 
                value={modalidadeEmEdicao.nome} 
                onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, nome: e.target.value})} 
              />
            </div>
            
            <div>
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Professor Responsável</label>
              <select 
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent cursor-pointer"
                value={modalidadeEmEdicao.professor_id}
                onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, professor_id: e.target.value})}
              >
                <option value="">Sem professor (Opcional)</option>
                {professores.map(prof => (
                  <option key={prof.id} value={prof.id}>{prof.nome}</option>
                ))}
              </select>
            </div>

            <button disabled={savingEdit} className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all disabled:opacity-50">
              {savingEdit ? <RefreshCw className="animate-spin" size={20}/> : "Salvar Alterações"}
            </button>
          </form>
        )}
      </Modal>

    </div>
  );
}