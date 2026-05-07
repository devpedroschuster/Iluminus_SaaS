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
        .select('id, nome, preco, duracao_meses, regras_acesso'); // Adicionados campos cruciais
      
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

    // Função select
  const toggleModalidade = (mod) => {
    setModalidadesSelecionadas(prev => 
      prev.includes(mod) 
        ? prev.filter(item => item !== mod)
        : [...prev, mod]
    );
  };

  // 1. ÚNICA função de cálculo de data
  const calcularDataFimPorVencimento = (dataVencimentoStr, mesesPlano) => {
    const d = new Date(dataVencimentoStr + 'T12:00:00'); 
    d.setDate(d.getDate() + (Number(mesesPlano) * 30));
    return d.toISOString().split('T')[0];
  };

  // 3. Submissão completa: Aluno + Histórico + Financeiro
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      // CORREÇÃO: Comparamos como String para evitar erro de tipo (Texto vs Número)
      const planoInfos = planos.find(p => String(p.id) === String(planoSelecionado));
      
      if (!planoInfos) {
        throw new Error("Informações do plano não encontradas.");
      }

      const meses = planoInfos.duracao_meses || 1;
      const dataInicio = new Date().toISOString().split('T')[0];
      const dataFim = calcularDataFimPorVencimento(dataVencimento, meses);

      // A. Atualiza o cadastro do Aluno
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

      // B. Grava no Histórico de Planos (Para aparecer no perfil)
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

      // C. Cria a Mensalidade (Para aparecer no Financeiro)
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
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
            
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

            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
  <label className="block text-sm font-bold text-blue-800 mb-2">Data do 1º Pagamento (Combinada)</label>
  <input
    type="date"
    value={dataVencimento}
    min={new Date().toISOString().split('T')[0]}
    onChange={(e) => setDataVencimento(e.target.value)}
    className="w-full bg-white border-none rounded-xl px-4 py-2 font-bold text-gray-700 focus:ring-2 focus:ring-blue-500/20"
  />
  <p className="text-[10px] text-blue-600 mt-2">
    O plano terá validade de 30 dias a partir desta data de pagamento.
  </p>
</div>

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