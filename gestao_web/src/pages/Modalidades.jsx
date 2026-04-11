import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Activity, RefreshCw, UserCheck, Edit2, Users, Clock, DollarSign, Calendar, AlertCircle } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';
import Modal from '../components/shared/Modal';
import { modalidadeService } from '../services/modalidadeService'; 

export default function Modalidades() {
  const [modalidades, setModalidades] = useState([]);
  const [professores, setProfessores] = useState([]);
  
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  // ESTADO INICIAL AGORA COM AS 3 FATIAS
  const [novaModalidade, setNovaModalidade] = useState({ 
    nome: '', professor_id: '', taxa_professor: 50, taxa_espaco: 50, taxa_direcao: 0 
  });

  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [modalidadeEmEdicao, setModalidadeEmEdicao] = useState(null);

  const [modalPerfilAberto, setModalPerfilAberto] = useState(false);
  const [modPerfil, setModPerfil] = useState(null);
  const [dadosPerfil, setDadosPerfil] = useState({ horarios: [], alunos: [] });
  const [loadingPerfil, setLoadingPerfil] = useState(false);

  // LÓGICA DE VALIDAÇÃO (A soma deve ser sempre 100)
  const totalTaxasNova = Number(novaModalidade.taxa_professor) + Number(novaModalidade.taxa_espaco) + Number(novaModalidade.taxa_direcao);
  const isNovaValida = totalTaxasNova === 100;

  const totalTaxasEdicao = modalidadeEmEdicao ? (Number(modalidadeEmEdicao.taxa_professor) + Number(modalidadeEmEdicao.taxa_espaco) + Number(modalidadeEmEdicao.taxa_direcao)) : 0;
  const isEdicaoValida = totalTaxasEdicao === 100;

  useEffect(() => { 
    fetchDados(); 
  }, []);

  async function fetchDados() {
    try {
      const { data: profs } = await supabase.from('professores').select('id, nome').eq('ativo', true).order('nome');
      if (profs) setProfessores(profs);

      const mods = await modalidadeService.listar();
      if (mods) setModalidades(mods);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      setLoadingList(false);
    }
  }

  async function abrirPerfil(mod) {
    setModPerfil(mod);
    setModalPerfilAberto(true);
    setLoadingPerfil(true);
    try {
      const dados = await modalidadeService.buscarPerfil(mod.id, mod.nome);
      setDadosPerfil(dados);
    } catch (error) {
      showToast.error("Erro ao carregar Raio-X da modalidade.");
    } finally {
      setLoadingPerfil(false);
    }
  }

  async function handleCriarModalidade(e) {
    e.preventDefault();
    if (creating || !novaModalidade.nome || !isNovaValida) return; 
    setCreating(true);    

    try {
        await modalidadeService.salvar(novaModalidade);
        showToast.success("Modalidade adicionada com sucesso!");
        setNovaModalidade({ nome: '', professor_id: '', taxa_professor: 50, taxa_espaco: 50, taxa_direcao: 0 });
        fetchDados();
    } catch (err) {
        showToast.error("Erro ao adicionar modalidade. Verifique se o nome já existe.");
    } finally {
        setCreating(false); 
    }
  }

  async function excluirModalidade(id, e) {
    e.stopPropagation(); 
    if (!confirm("Tem certeza que deseja remover esta modalidade?")) return;
    setDeletingId(id); 
    try {
        await modalidadeService.excluir(id);
        showToast.success("Modalidade removida.");
        fetchDados();
    } catch (err) {
        showToast.error("Erro ao excluir. Pode haver aulas atreladas a ela.");
    } finally {
        setDeletingId(null);
    }
  }

  function abrirEdicao(mod, e) {
    e?.stopPropagation(); 
    setModalidadeEmEdicao({
      id: mod.id,
      nome: mod.nome,
      professor_id: mod.professor_id || '',
      taxa_professor: mod.taxa_professor || 0,
      taxa_espaco: mod.taxa_espaco || 0,
      taxa_direcao: mod.taxa_direcao || 0
    });
    setModalEdicaoAberto(true);
  }

  async function handleSalvarEdicao(e) {
    e.preventDefault();
    if (!modalidadeEmEdicao?.nome || !isEdicaoValida) return;
    setSavingEdit(true);

    try {
      await modalidadeService.salvar(modalidadeEmEdicao);
      showToast.success("Modalidade atualizada com sucesso!");
      setModalEdicaoAberto(false);
      if (modPerfil && modPerfil.id === modalidadeEmEdicao.id) {
          setModPerfil({...modPerfil, ...modalidadeEmEdicao});
      }
      fetchDados(); 
    } catch (err) {
      showToast.error("Erro ao atualizar modalidade.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
       <div>
          <h1 className="text-3xl font-black text-gray-800">Modalidades & Comissões</h1>
          <p className="text-gray-500">Cadastre as atividades, defina o repasse de lucros e acompanhe as turmas.</p>
       </div>

      {/* FORMULÁRIO DE NOVA MODALIDADE */}
      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Activity size={20}/> Nova Modalidade</h3>
        
        <form onSubmit={handleCriarModalidade} className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-[2] w-full">
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome da Modalidade</label>
              <input 
                required placeholder="Ex: Dança Criativa"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent transition-all" 
                value={novaModalidade.nome} onChange={e => setNovaModalidade({...novaModalidade, nome: e.target.value})} 
              />
            </div>
            
            <div className="flex-[2] w-full">
              <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Professor Responsável (Opcional)</label>
              <select 
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent cursor-pointer transition-all"
                value={novaModalidade.professor_id}
                onChange={e => setNovaModalidade({...novaModalidade, professor_id: e.target.value})}
              >
                <option value="">Sem professor fixo</option>
                {professores.map(prof => (
                  <option key={prof.id} value={prof.id}>{prof.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {/* AS 3 FATIAS DA PIZZA */}
          <div className="bg-orange-50 border border-orange-100 p-6 rounded-3xl">
            <div className="flex justify-between items-end mb-4">
               <div>
                 <h4 className="font-bold text-orange-900 flex items-center gap-2 text-sm"><DollarSign size={16}/> Divisão de Repasses (%)</h4>
                 <p className="text-xs text-orange-700/70 font-medium mt-1">A soma deve ser obrigatoriamente 100%.</p>
               </div>
               <div className={`text-xl font-black ${isNovaValida ? 'text-green-600' : 'text-red-500'}`}>
                 Total: {totalTaxasNova}%
               </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-blue-600 uppercase block mb-1">Professor</label>
                <input type="number" min="0" max="100" className="w-full p-3 bg-white rounded-xl outline-none font-black text-gray-800 text-center border-2 border-transparent focus:border-blue-400" value={novaModalidade.taxa_professor} onChange={e => setNovaModalidade({...novaModalidade, taxa_professor: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black text-orange-600 uppercase block mb-1">Espaço (Caixa)</label>
                <input type="number" min="0" max="100" className="w-full p-3 bg-white rounded-xl outline-none font-black text-gray-800 text-center border-2 border-transparent focus:border-orange-400" value={novaModalidade.taxa_espaco} onChange={e => setNovaModalidade({...novaModalidade, taxa_espaco: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black text-purple-600 uppercase block mb-1">Diretor (Gustavo)</label>
                <input type="number" min="0" max="100" className="w-full p-3 bg-white rounded-xl outline-none font-black text-gray-800 text-center border-2 border-transparent focus:border-purple-400" value={novaModalidade.taxa_direcao} onChange={e => setNovaModalidade({...novaModalidade, taxa_direcao: e.target.value})} />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
             <button disabled={creating || !isNovaValida} className="bg-iluminus-terracota text-white px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-lg shadow-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] w-full md:w-auto">
               {creating ? <RefreshCw className="animate-spin" size={24}/> : <Plus size={24}/>} Salvar Modalidade
             </button>
          </div>
        </form>
      </div>

      {/* GRADE DE MODALIDADES */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingList ? (
           [1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-3xl animate-pulse" />)
        ) : modalidades.map(mod => (
          <div 
            key={mod.id} 
            onClick={() => abrirPerfil(mod)}
            className="bg-white p-5 rounded-3xl border border-gray-100 flex justify-between items-center shadow-sm hover:shadow-lg hover:border-orange-200 hover:-translate-y-1 cursor-pointer transition-all group"
          >
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
              <button onClick={(e) => abrirEdicao(mod, e)} className="p-3 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Editar">
                <Edit2 size={18}/>
              </button>
              <button onClick={(e) => excluirModalidade(mod.id, e)} disabled={deletingId === mod.id} className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Excluir">
                  {deletingId === mod.id ? <RefreshCw className="animate-spin text-red-500" size={18}/> : <Trash2 size={18}/>}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* SUPER PAINEL (RAIO-X DA MODALIDADE) */}
      <Modal isOpen={modalPerfilAberto} onClose={() => setModalPerfilAberto(false)} titulo="Raio-X da Turma">
        {modPerfil && (
          <div className="space-y-6 pt-2 max-h-[70vh] overflow-y-auto custom-scrollbar pr-2">
            
            <div className="bg-gray-800 p-6 rounded-3xl flex justify-between items-center relative overflow-hidden">
                <div className="relative z-10">
                    <h2 className="text-2xl font-black text-white mb-1">{modPerfil.nome}</h2>
                    <p className="text-gray-300 flex items-center gap-2 text-sm font-medium">
                        <UserCheck size={16} className={modPerfil.professores ? "text-green-400" : "text-gray-500"}/> 
                        {modPerfil.professores ? modPerfil.professores.nome : "Nenhum professor fixo atribuído"}
                    </p>
                </div>
                <button onClick={() => abrirEdicao(modPerfil)} className="relative z-10 bg-white/10 hover:bg-white/20 text-white p-3 rounded-xl backdrop-blur-sm transition-all" title="Editar Configurações">
                    <Edit2 size={20} />
                </button>
                <div className="absolute -right-8 -top-8 text-white/5 rotate-12">
                    <Activity size={120} />
                </div>
            </div>

            {loadingPerfil ? (
                <div className="flex justify-center py-10"><RefreshCw className="animate-spin text-gray-300" size={32} /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Alunos Matriculados */}
                    <div className="bg-gray-50 border border-gray-100 p-5 rounded-3xl">
                        <h4 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
                            <Users size={18} className="text-blue-500"/> Alunos Ativos ({dadosPerfil.alunos.length})
                        </h4>
                        
                        {dadosPerfil.alunos.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-4">Nenhum aluno vinculado no momento.</p>
                        ) : (
                            <ul className="space-y-2">
                                {dadosPerfil.alunos.map(aluno => (
                                    <li key={aluno.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
                                        <span className="font-bold text-sm text-gray-700">{aluno.nome_completo}</span>
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-1 rounded-md">{aluno.planos?.nome || 'Sem plano'}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* COLUNA DIREITA: Agenda & Comissões */}
                    <div className="flex flex-col gap-4">
                        
                        <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm flex-1">
                            <h4 className="font-bold text-gray-800 flex items-center gap-2 mb-4"><Clock size={18} className="text-purple-500"/> Horários na Grade</h4>
                            {dadosPerfil.horarios.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">Não há aulas recorrentes cadastradas no calendário.</p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {dadosPerfil.horarios.map((h, i) => (
                                        <li key={i} className="bg-purple-50 text-purple-700 border border-purple-100 px-3 py-3 rounded-xl text-sm font-bold flex items-center gap-3">
                                            <Calendar size={16} /> {h.dia_semana}, {h.horario.slice(0,5)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* NOVO BOX DE REPASSE (Com as 3 taxas) */}
                        <div className="bg-orange-50 border border-orange-100 p-5 rounded-3xl shadow-sm">
                            <h4 className="font-bold text-orange-900 flex items-center gap-2 mb-3 text-sm"><DollarSign size={16}/> Regras de Repasse</h4>
                            <div className="flex gap-2">
                                <div className="flex-1 bg-white p-2 rounded-xl text-center shadow-sm">
                                    <span className="block text-[10px] font-black text-blue-600 uppercase">Prof</span>
                                    <span className="text-sm font-black text-gray-800">{modPerfil.taxa_professor || 0}%</span>
                                </div>
                                <div className="flex-1 bg-white p-2 rounded-xl text-center shadow-sm">
                                    <span className="block text-[10px] font-black text-orange-500 uppercase">Caixa</span>
                                    <span className="text-sm font-black text-gray-800">{modPerfil.taxa_espaco || 0}%</span>
                                </div>
                                <div className="flex-1 bg-white p-2 rounded-xl text-center shadow-sm">
                                    <span className="block text-[10px] font-black text-purple-600 uppercase">Dir</span>
                                    <span className="text-sm font-black text-gray-800">{modPerfil.taxa_direcao || 0}%</span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            )}
          </div>
        )}
      </Modal>

      {/* MODAL DE EDIÇÃO TRADICIONAL */}
      <Modal isOpen={modalEdicaoAberto} onClose={() => setModalEdicaoAberto(false)} titulo="Editar Configurações">
        {modalidadeEmEdicao && (
          <form onSubmit={handleSalvarEdicao} className="space-y-6 pt-4">
            <div className="flex gap-4">
                <div className="flex-[2] w-full">
                <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Nome</label>
                <input 
                    required 
                    className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent" 
                    value={modalidadeEmEdicao.nome} 
                    onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, nome: e.target.value})} 
                />
                </div>
                
                <div className="flex-[2] w-full">
                <label className="text-xs font-black text-gray-400 uppercase mb-2 block">Professor Fixo</label>
                <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 focus:border-orange-200 border border-transparent cursor-pointer"
                    value={modalidadeEmEdicao.professor_id}
                    onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, professor_id: e.target.value})}
                >
                    <option value="">Sem professor</option>
                    {professores.map(prof => (
                    <option key={prof.id} value={prof.id}>{prof.nome}</option>
                    ))}
                </select>
                </div>
            </div>

            <div className="bg-gray-50 border border-gray-100 p-4 rounded-2xl">
                <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-black text-gray-500 uppercase block">Divisão da Comissão</label>
                    <span className={`text-xs font-black ${isEdicaoValida ? 'text-green-500' : 'text-red-500'}`}>Total: {totalTaxasEdicao}%</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <span className="text-[10px] uppercase font-bold text-blue-500 mb-1 block">Prof</span>
                        <input type="number" className="w-full p-2 rounded-lg border border-gray-200 text-center font-bold" value={modalidadeEmEdicao.taxa_professor} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, taxa_professor: e.target.value})} />
                    </div>
                    <div>
                        <span className="text-[10px] uppercase font-bold text-orange-500 mb-1 block">Espaço</span>
                        <input type="number" className="w-full p-2 rounded-lg border border-gray-200 text-center font-bold" value={modalidadeEmEdicao.taxa_espaco} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, taxa_espaco: e.target.value})} />
                    </div>
                    <div>
                        <span className="text-[10px] uppercase font-bold text-purple-500 mb-1 block">Diretor</span>
                        <input type="number" className="w-full p-2 rounded-lg border border-gray-200 text-center font-bold" value={modalidadeEmEdicao.taxa_direcao} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, taxa_direcao: e.target.value})} />
                    </div>
                </div>
                {!isEdicaoValida && <p className="text-[10px] font-bold text-red-500 mt-2 flex items-center gap-1"><AlertCircle size={12}/> A soma das 3 partes deve dar 100%.</p>}
            </div>

            <button disabled={savingEdit || !isEdicaoValida} className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all disabled:opacity-50">
              {savingEdit ? <RefreshCw className="animate-spin" size={20}/> : "Salvar Alterações"}
            </button>
          </form>
        )}
      </Modal>

    </div>
  );
}