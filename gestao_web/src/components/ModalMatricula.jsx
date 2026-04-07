import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, CheckCircle2, Package, Save, Loader2 } from 'lucide-react';
import { showToast } from '../components/shared/Toast';

export default function ModalMatricula({ aluno, onClose, onMatriculaSucesso }) {
  const [planos, setPlanos] = useState([]);
  const [modalidades, setModalidades] = useState([]);
  
  const [planoSelecionado, setPlanoSelecionado] = useState(aluno?.plano_id || '');
  const [modalidadesSelecionadas, setModalidadesSelecionadas] = useState(
    aluno?.modalidades_selecionadas || []
  );
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    setLoading(true);
    try {
      const { data: planosData } = await supabase.from('planos').select('id, nome, regras_acesso');
      const { data: modData } = await supabase.from('modalidades').select('nome').order('nome');
      
      if (planosData) setPlanos(planosData);
      if (modData && modData.length > 0) {
        setModalidades(modData.map(m => m.nome));
      } else {
        setModalidades(['Funcional', 'Dança Criativa', 'Free Funk', 'Ballet', 'Jazz', 'Yoga']);
      }
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      setLoading(false);
    }
  }

  // Função select
  const toggleModalidade = (mod) => {
    setModalidadesSelecionadas(prev => 
      prev.includes(mod) 
        ? prev.filter(item => item !== mod)
        : [...prev, mod]
    );
  };

  async function handleSalvar(e) {
    e.preventDefault();
    if (!planoSelecionado) {
      showToast.error("Por favor, selecione um plano.");
      return;
    }
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('alunos')
        .update({ 
          plano_id: planoSelecionado,
          modalidades_selecionadas: modalidadesSelecionadas 
        })
        .eq('id', aluno.id);

      if (error) throw error;

      showToast.success("Matrícula atualizada com sucesso!");
      onMatriculaSucesso();
      onClose();
    } catch (error) {
      showToast.error("Erro ao salvar matrícula.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-center items-center z-50 p-4 animate-in fade-in">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Cabeçalho do Modal */}
        <div className="bg-gray-50 p-6 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-gray-800 flex items-center gap-2">
              <Package className="text-iluminus-terracota" /> 
              Matrícula do Aluno
            </h2>
            <p className="text-sm text-gray-500 font-medium mt-1">
              {aluno?.nome_completo || 'Aluno selecionado'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-white rounded-full text-gray-400 hover:text-red-500 shadow-sm transition-colors">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-orange-400" size={40} /></div>
        ) : (
          <form onSubmit={handleSalvar} className="p-6 overflow-y-auto space-y-6">
            
            {/* Seleção do Plano */}
            <div>
              <label className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3 block">1. Escolha o Plano</label>
              <div className="grid grid-cols-1 gap-3">
                {planos.map(plano => (
                  <label key={plano.id} className={`cursor-pointer border-2 rounded-2xl p-4 flex items-center justify-between transition-all ${planoSelecionado === plano.id ? 'border-iluminus-terracota bg-orange-50' : 'border-gray-100 hover:border-orange-200 bg-white'}`}>
                    <span className={`font-bold ${planoSelecionado === plano.id ? 'text-iluminus-terracota' : 'text-gray-600'}`}>
                      {plano.nome}
                    </span>
                    <input 
                      type="radio" 
                      name="plano" 
                      className="hidden"
                      value={plano.id}
                      checked={planoSelecionado === plano.id}
                      onChange={(e) => setPlanoSelecionado(e.target.value)}
                    />
                    {planoSelecionado === plano.id && <CheckCircle2 className="text-iluminus-terracota" size={20} />}
                  </label>
                ))}
              </div>
            </div>

            {/* Seleção das Modalidades */}
            {planoSelecionado && (
              <div className="animate-in slide-in-from-top-4">
                <label className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3 block">2. Selecione as Modalidades</label>
                <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                  <div className="grid grid-cols-2 gap-3">
                    {modalidades.map(mod => {
  const isChecked = modalidadesSelecionadas.includes(mod);
  return (
    <label key={mod} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${isChecked ? 'bg-white shadow-sm border border-orange-100' : 'hover:bg-gray-100 border border-transparent'}`}>
      
      <input 
        type="checkbox" 
        className="hidden"
        checked={isChecked}
        onChange={() => toggleModalidade(mod)}
      />
      
      <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-colors ${isChecked ? 'bg-iluminus-terracota border-iluminus-terracota' : 'bg-white border-gray-300'}`}>
        {isChecked && <CheckCircle2 className="text-white w-4 h-4" />}
      </div>
      <span className={`text-sm font-bold ${isChecked ? 'text-gray-800' : 'text-gray-500'}`}>
        {mod}
      </span>
    </label>
  );
})}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2 font-medium">Marque apenas as modalidades inclusas no pacote contratado.</p>
              </div>
            )}

            {/* Botão Salvar */}
            <button 
              type="submit" 
              disabled={saving || !planoSelecionado}
              className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-orange-100 disabled:opacity-50 transition-all hover:scale-[1.02]"
            >
              {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {saving ? 'Salvando...' : 'Confirmar Matrícula'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}