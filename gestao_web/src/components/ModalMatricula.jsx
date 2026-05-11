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
  const [dataVencimento, setDataVencimento] = useState(new Date().toISOString().split('T')[0]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    setLoading(true);
    try {
      const { data: planosData } = await supabase
        .from('planos')
        .select('id, nome, preco, duracao_meses, regras_acesso');
      
      const { data: modData } = await supabase.from('modalidades').select('nome').order('nome');
      
      if (planosData) setPlanos(planosData);
      if (modData && modData.length > 0) {
        setModalidades(modData.map(m => m.nome));
      }
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      setLoading(false);
    }
  }

  const toggleModalidade = (mod) => {
    setModalidadesSelecionadas(prev => 
      prev.includes(mod) 
        ? prev.filter(item => item !== mod)
        : [...prev, mod]
    );
  };

  const calcularDataFimPorVencimento = (dataVencimentoStr, mesesPlano) => {
    const d = new Date(dataVencimentoStr + 'T12:00:00'); 
    d.setDate(d.getDate() + (Number(mesesPlano) * 30));
    return d.toISOString().split('T')[0];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const planoInfos = planos.find(p => String(p.id) === String(planoSelecionado));
      
      if (!planoInfos) {
        throw new Error("Informações do plano não encontradas.");
      }

      const meses = planoInfos.duracao_meses || 1;
      const dataInicio = new Date().toISOString().split('T')[0];
      const dataFim = calcularDataFimPorVencimento(dataVencimento, meses);

      const { error: errAluno } = await supabase
        .from('alunos')
        .update({
          plano_id: planoSelecionado,
          modalidades_selecionadas: modalidadesSelecionadas,
          data_inicio_plano: dataInicio,
          data_fim_plano: dataFim
        })
        .eq('id', aluno.id);

      if (errAluno) throw errAluno;

      const { error: errHist } = await supabase
        .from('historico_planos')
        .insert([{
          aluno_id: aluno.id,
          plano_id: planoSelecionado,
          data_inicio: dataInicio,
          data_fim: dataFim,
          status: 'ativo',
          valor_pago: planoInfos.preco || 0
        }]);

      if (errHist) throw errHist;

      const { error: errMensalidade } = await supabase
        .from('mensalidades')
        .insert([{
          aluno_id: aluno.id,
          plano_id: planoSelecionado,
          data_vencimento: dataVencimento,
          status: 'pendente'
        }]);

      if (errMensalidade) throw errMensalidade;

      showToast.success('Matrícula, Histórico e Financeiro gerados com sucesso!');
      onMatriculaSucesso();
      onClose();
    } catch (error) {
      console.error(error);
      showToast.error('Erro ao processar matrícula completa');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 animate-in fade-in">
      <div className="bg-white dark:bg-[#1A1A1A] dark:border dark:border-zinc-800 rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Cabeçalho do Modal */}
        <div className="bg-gray-50 dark:bg-zinc-900 p-6 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-gray-800 dark:text-white flex items-center gap-2">
              <Package className="text-iluminus-terracota" /> 
              Matrícula do Aluno
            </h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400 font-medium mt-1">
              {aluno?.nome_completo || 'Aluno selecionado'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-white dark:bg-zinc-800 rounded-full text-gray-400 dark:text-zinc-500 hover:text-red-500 shadow-sm transition-colors">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-orange-400" size={40} /></div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
            
            {/* Seleção do Plano */}
            <div>
              <label className="text-xs font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-3 block">1. Escolha o Plano</label>
              <div className="grid grid-cols-1 gap-3">
                {planos.map(plano => (
                  <label key={plano.id} className={`cursor-pointer border-2 rounded-2xl p-4 flex items-center justify-between transition-all ${planoSelecionado === plano.id ? 'border-iluminus-terracota bg-orange-50 dark:bg-orange-950/20' : 'border-gray-100 dark:border-zinc-800 hover:border-orange-200 dark:hover:border-zinc-700 bg-white dark:bg-zinc-800/40'}`}>
                    <span className={`font-bold ${planoSelecionado === plano.id ? 'text-iluminus-terracota' : 'text-gray-600 dark:text-zinc-300'}`}>
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
                <label className="text-xs font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-3 block">2. Selecione as Modalidades</label>
                <div className="bg-gray-50 dark:bg-zinc-900/40 p-5 rounded-2xl border border-gray-100 dark:border-zinc-800">
                  <div className="grid grid-cols-2 gap-3">
                    {modalidades.map(mod => {
                      const isChecked = modalidadesSelecionadas.includes(mod);
                      return (
                        <label key={mod} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${isChecked ? 'bg-white dark:bg-zinc-800 shadow-sm border border-orange-100 dark:border-orange-900/30' : 'hover:bg-gray-100 dark:hover:bg-zinc-800 border border-transparent'}`}>
                          <input 
                            type="checkbox" 
                            className="hidden"
                            checked={isChecked}
                            onChange={() => toggleModalidade(mod)}
                          />
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-colors ${isChecked ? 'bg-iluminus-terracota border-iluminus-terracota' : 'bg-white dark:bg-zinc-900 border-gray-300 dark:border-zinc-700'}`}>
                            {isChecked && <CheckCircle2 className="text-white w-4 h-4" />}
                          </div>
                          <span className={`text-sm font-bold ${isChecked ? 'text-gray-800 dark:text-zinc-200' : 'text-gray-500 dark:text-zinc-500'}`}>
                            {mod}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Bloco de Data */}
            <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-2xl border border-blue-100 dark:border-blue-900">
              <label className="block text-sm font-bold text-blue-800 dark:text-blue-300 mb-2">Data do 1º Pagamento (Combinada)</label>
              <input
                type="date"
                value={dataVencimento}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDataVencimento(e.target.value)}
                className="w-full bg-white dark:bg-zinc-900 border-none rounded-xl px-4 py-2 font-bold text-gray-700 dark:text-zinc-200 focus:ring-2 focus:ring-blue-500/20 outline-none"
              />
              <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-2 font-medium">
                O plano terá validade de 30 dias a partir desta data de pagamento.
              </p>
            </div>

            <button 
              type="submit" 
              disabled={saving || !planoSelecionado}
              className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-orange-100 dark:shadow-none disabled:opacity-50 transition-all hover:scale-[1.02]"
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