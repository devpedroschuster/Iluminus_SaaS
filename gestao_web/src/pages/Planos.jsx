import React, { useEffect, useState } from 'react';
import { planosService } from '../services/planosService';
import { Plus, Trash2, Package, RefreshCw, Calendar, Edit2, Clock } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';
import Modal, { useModal, ModalConfirmacao } from '../components/shared/Modal';

export default function Planos() {
  const [planos, setPlanos] = useState([]);
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  const [novoPlano, setNovoPlano] = useState({ 
    nome: '', preco: '', frequencia_semanal: '', duracao_meses: 1, regras_acesso: []
  });

  const modalEdicao = useModal();
  const [savingEdit, setSavingEdit] = useState(false);
  const [planoEmEdicao, setPlanoEmEdicao] = useState(null);
  
  const modalExcluir = useModal();
  const [planoParaExcluir, setPlanoParaExcluir] = useState(null);

  useEffect(() => { fetchPlanos(); }, []);

  async function fetchPlanos() {
    try {
      const data = await planosService.listar();
      setPlanos(data || []);
    } catch (err) {
      showToast.error("Erro ao carregar planos.");
    } finally {
      setLoadingList(false);
    }
  }

  async function handleCriarPlano(e) {
    e.preventDefault();
    if (creating) return; 
    setCreating(true);    

    try {
        await planosService.salvar(novoPlano);
        showToast.success("Plano criado com sucesso!");
        setNovoPlano({ nome: '', preco: '', frequencia_semanal: '', duracao_meses: 1, regras_acesso: [] });
        fetchPlanos();
    } catch (err) {
        showToast.error("Erro ao criar plano.");
    } finally {
        setCreating(false); 
    }
  }

  async function excluirPlano() {
    if (!planoParaExcluir) return;
    setDeletingId(planoParaExcluir.id); 
    modalExcluir.fechar();

    try {
        await planosService.excluir(planoParaExcluir.id);
        showToast.success("Plano removido.");
        fetchPlanos();
    } catch (err) {
        showToast.error("Erro ao excluir. Verifique se há alunos vinculados a ele.");
    } finally {
        setDeletingId(null);
        setPlanoParaExcluir(null);
    }
  }

  function abrirEdicao(plano) {
    setPlanoEmEdicao({ ...plano, duracao_meses: plano.duracao_meses || 1, regras_acesso: plano.regras_acesso || [] });
    modalEdicao.abrir();
  }

  async function handleSalvarEdicao(e) {
    e.preventDefault();
    if (savingEdit) return;
    setSavingEdit(true);

    try {
      await planosService.salvar(planoEmEdicao);
      showToast.success("Plano atualizado com sucesso!");
      modalEdicao.fechar();
      fetchPlanos();
    } catch (err) {
      showToast.error("Erro ao atualizar plano.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in max-w-full">
       <div>
          <h1 className="text-3xl font-black text-gray-800">Planos e Mensalidades</h1>
          <p className="text-gray-500">Cadastre e edite os pacotes comerciais vendidos no estúdio.</p>
       </div>

      <div className="bg-white p-6 md:p-8 rounded-[40px] border border-gray-100 shadow-sm w-full">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2"><Package size={20}/> Criar Novo Plano</h3>
        
        <form onSubmit={handleCriarPlano} className="space-y-4 w-full">
          <div className="flex flex-col md:flex-row gap-4 items-end w-full">
            <div className="flex-1 w-full">
              <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Nome do Plano</label>
              <input 
                required placeholder="Ex: Livre Dança"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-colors" 
                value={novoPlano.nome} onChange={e => setNovoPlano({...novoPlano, nome: e.target.value})} 
              />
            </div>
            
            <div className="w-full md:w-32">
              <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Preço (R$)</label>
              <input 
                required type="number" step="0.01" placeholder="0.00"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-colors" 
                value={novoPlano.preco} onChange={e => setNovoPlano({...novoPlano, preco: e.target.value})} 
              />
            </div>

            <div className="w-full md:w-36">
              <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Freq. Visível</label>
              <input 
                required placeholder="Ex: Livre"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-colors" 
                value={novoPlano.frequencia_semanal} onChange={e => setNovoPlano({...novoPlano, frequencia_semanal: e.target.value})} 
              />
            </div>

            <div className="w-full md:w-32">
              <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Duração (Meses)</label>
              <input 
                required type="number" min="1" max="24"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-black text-blue-600 focus:border-blue-200 border border-transparent transition-colors" 
                value={novoPlano.duracao_meses} onChange={e => setNovoPlano({...novoPlano, duracao_meses: e.target.value})} 
              />
            </div>

            <button disabled={creating} className="bg-iluminus-terracota text-white px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-lg shadow-orange-100 disabled:opacity-70 transition-all hover:scale-[1.02] w-full md:w-auto mt-4 md:mt-0">
              {creating ? <RefreshCw className="animate-spin" size={24}/> : <Plus size={24}/>}
              {creating ? "Salvando..." : "Salvar"}
            </button>
          </div>

          <SeletorRegras 
            regras={novoPlano.regras_acesso} 
            setRegras={(novasRegras) => setNovoPlano({...novoPlano, regras_acesso: novasRegras})} 
          />
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingList ? (
           [1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-3xl animate-pulse" />)
        ) : planos.map(plano => (
          <div key={plano.id} className="bg-white p-6 rounded-3xl border border-gray-100 flex justify-between items-center shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center gap-4">
               <div className="bg-orange-50 p-4 rounded-2xl text-iluminus-terracota"><Package size={24}/></div>
               <div>
                 <h3 className="font-black text-lg text-gray-800 leading-tight">{plano.nome}</h3>
                 <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-400 mt-1">
                    <span className="text-green-600 font-black">R$ {plano.preco}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span className="flex items-center gap-1"><Calendar size={12}/> {plano.frequencia_semanal}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span className="flex items-center gap-1 text-blue-500 font-bold"><Clock size={12}/> {plano.duracao_meses} {plano.duracao_meses > 1 ? 'Meses' : 'Mês'}</span>
                 </div>
               </div>
            </div>

            <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                <button onClick={() => abrirEdicao(plano)} className="p-3 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Editar Plano">
                    <Edit2 size={18}/>
                </button>
                <button 
                  onClick={() => { setPlanoParaExcluir(plano); modalExcluir.abrir(); }} 
                  disabled={deletingId === plano.id} 
                  className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" 
                  title="Excluir Plano"
                >
                    {deletingId === plano.id ? <RefreshCw className="animate-spin text-red-500" size={18}/> : <Trash2 size={18}/>}
                </button>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={modalEdicao.isOpen} onClose={modalEdicao.fechar} titulo="Editar Pacote / Plano">
        {planoEmEdicao && (
          <form onSubmit={handleSalvarEdicao} className="space-y-6 pt-4">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Nome Comercial do Plano</label>
              <input 
                required className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-transparent transition-colors" 
                value={planoEmEdicao.nome} onChange={e => setPlanoEmEdicao({...planoEmEdicao, nome: e.target.value})} 
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Preço de Venda</label>
                <input 
                  required type="number" step="0.01" className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-green-600 focus:border-blue-300 border border-transparent transition-colors" 
                  value={planoEmEdicao.preco} onChange={e => setPlanoEmEdicao({...planoEmEdicao, preco: e.target.value})} 
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Frequência</label>
                <input 
                  required className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-blue-300 border border-transparent transition-colors" 
                  value={planoEmEdicao.frequencia_semanal} onChange={e => setPlanoEmEdicao({...planoEmEdicao, frequencia_semanal: e.target.value})} 
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Duração (Meses)</label>
                <input 
                  required type="number" min="1" max="24" className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-black text-blue-600 focus:border-blue-300 border border-transparent transition-colors" 
                  value={planoEmEdicao.duracao_meses} onChange={e => setPlanoEmEdicao({...planoEmEdicao, duracao_meses: e.target.value})} 
                />
              </div>
            </div>

            <SeletorRegras 
              regras={planoEmEdicao.regras_acesso} 
              setRegras={(novasRegras) => setPlanoEmEdicao({...planoEmEdicao, regras_acesso: novasRegras})} 
            />

            <button disabled={savingEdit} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-100 hover:scale-[1.02] transition-all disabled:opacity-50">
              {savingEdit ? <RefreshCw className="animate-spin" size={20}/> : "Atualizar Plano"}
            </button>
          </form>
        )}
      </Modal>

      <ModalConfirmacao 
        isOpen={modalExcluir.isOpen}
        onClose={modalExcluir.fechar}
        onConfirm={excluirPlano}
        titulo="Remover Pacote / Plano?"
        mensagem={`Tem certeza que deseja excluir o plano "${planoParaExcluir?.nome}" permanentemente?`}
        tipo="danger"
      />
    </div>
  );
}

function SeletorRegras({ regras, setRegras }) {
  const [mod, setMod] = useState('Dança');
  const [qty, setQty] = useState('1');

  const adicionarRegra = () => {
    // Evita duplicar regras para a mesma área
    if (regras.some(r => r.modalidade === mod)) {
        showToast.error(`A regra para ${mod} já existe neste plano.`);
        return;
    }
    setRegras([...regras, { modalidade: mod, limite: Number(qty) }]);
  };

  const removerRegra = (index) => {
    const novas = [...regras];
    novas.splice(index, 1);
    setRegras(novas);
  };

  return (
    <div className="space-y-4 border-t border-gray-100 pt-6 mt-6 w-full">
      <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">
        Regras de Acesso do Pacote
      </label>
      
      {regras.map((regra, index) => (
        <div key={index} className="flex gap-2 items-center bg-gray-50 p-3 rounded-2xl animate-in slide-in-from-left-2">
          <div className="flex-1 font-bold text-gray-700 text-sm">Área: {regra.modalidade}</div>
          <div className="font-black text-blue-600 bg-white px-3 py-1 rounded-lg border border-gray-100">
            {regra.limite === 999 ? 'Ilimitado (Livre)' : `${regra.limite}x na semana`}
          </div>
          <button 
            type="button"
            onClick={() => removerRegra(index)}
            className="p-2 text-red-400 hover:text-red-600 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      <div className="grid grid-cols-5 gap-2 items-end bg-blue-50/50 p-4 rounded-3xl border border-dashed border-blue-100">
        <div className="col-span-2">
          <label className="text-[9px] font-black text-blue-400 uppercase ml-2">Categoria</label>
          <select 
            className="w-full p-3 bg-white rounded-xl outline-none text-sm font-bold cursor-pointer"
            value={mod} onChange={e => setMod(e.target.value)}
          >
            <option value="Dança">Dança</option>
            <option value="Funcional">Funcional</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[9px] font-black text-blue-400 uppercase ml-2">Limite na Semana</label>
          <select 
            className="w-full p-3 bg-white rounded-xl outline-none text-sm font-black cursor-pointer text-blue-700"
            value={qty} onChange={e => setQty(e.target.value)}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="4">4x</option>
            <option value="5">5x</option>
            <option value="6">6x</option>
            <option value="999">Ilimitado (Livre)</option>
          </select>
        </div>
        <button 
          type="button"
          onClick={adicionarRegra}
          className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 transition-colors flex justify-center"
        >
          <Plus size={20} />
        </button>
      </div>
    </div>
  );
}