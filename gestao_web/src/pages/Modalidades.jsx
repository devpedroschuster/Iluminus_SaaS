import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Activity, RefreshCw, Edit2, Users, Clock, DollarSign, Calendar, AlertCircle, Tag } from 'lucide-react'; 
import { showToast } from '../components/shared/Toast';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';
import { modalidadeService } from '../services/modalidadeService'; 

export default function Modalidades() {
  const [modalidades, setModalidades] = useState([]);
  const [professores, setProfessores] = useState([]);
  
  const [loadingList, setLoadingList] = useState(true); 
  const [creating, setCreating] = useState(false);      
  const [deletingId, setDeletingId] = useState(null);   

  const [novaModalidade, setNovaModalidade] = useState({ 
    nome: '', area: 'Dança', professor_id: '', capacidade_padrao: 15, taxa_professor: 50, taxa_espaco: 50, taxa_direcao: 0 
  });

  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [modalidadeEmEdicao, setModalidadeEmEdicao] = useState(null);

  const [modalPerfilAberto, setModalPerfilAberto] = useState(false);
  const [modPerfil, setModPerfil] = useState(null);
  const [dadosPerfil, setDadosPerfil] = useState({ horarios: [], alunos: [] });
  const [loadingPerfil, setLoadingPerfil] = useState(false);

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
        const payload = {
          ...novaModalidade,
          capacidade_padrao: Number(novaModalidade.capacidade_padrao)
        };
        await modalidadeService.salvar(payload);
        showToast.success("Modalidade adicionada com sucesso!");
        setNovaModalidade({ nome: '', area: 'Dança', professor_id: '', capacidade_padrao: 15, taxa_professor: 50, taxa_espaco: 50, taxa_direcao: 0 });
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
      area: mod.area || 'Dança', 
      professor_id: mod.professor_id || '',
      capacidade_padrao: mod.capacidade_padrao || 15,
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
      const payload = {
        ...modalidadeEmEdicao,
        capacidade_padrao: Number(modalidadeEmEdicao.capacidade_padrao)
      };
      await modalidadeService.salvar(payload);
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

  const getAreaColor = (area) => {
    switch (area) {
      case 'Dança': return 'bg-purple-soft text-purple border-purple/20';
      case 'Funcional': return 'bg-warning-soft text-warning border-warning/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
       <div>
          <h1 className="text-3xl font-black text-foreground">Modalidades & Comissões</h1>
          <p className="text-muted-foreground">Cadastre as atividades, limites de vagas e regras financeiras.</p>
       </div>

      {/* FORMULÁRIO DE NOVA MODALIDADE */}
      <Surface variant="card" padding="lg" className="space-y-6">
        <h3 className="font-bold text-foreground flex items-center gap-2"><Activity size={20}/> Nova Modalidade</h3>
        
        <form onSubmit={handleCriarModalidade} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="w-full">
              <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Nome da Modalidade</label>
              <Input 
                required placeholder="Ex: Dança Criativa"
                value={novaModalidade.nome} onChange={e => setNovaModalidade({...novaModalidade, nome: e.target.value})} 
              />
            </div>

            <div className="w-full">
              <label className="text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-1"><Tag size={12}/> Área / Categoria</label>
              <Input as="select"
                value={novaModalidade.area}
                onChange={e => setNovaModalidade({...novaModalidade, area: e.target.value})}
              >
                <option value="Dança">Dança</option>
                <option value="Funcional">Funcional</option>
                <option value="Livre/Todos">Livre / Outros</option>
              </Input>
            </div>
            
            <div className="w-full">
              <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Professor Responsável (Opcional)</label>
              <Input as="select"
                value={novaModalidade.professor_id}
                onChange={e => setNovaModalidade({...novaModalidade, professor_id: e.target.value})}
              >
                <option value="">Sem professor fixo</option>
                {professores.map(prof => (
                  <option key={prof.id} value={prof.id}>{prof.nome}</option>
                ))}
              </Input>
            </div>

            <div className="w-full">
              <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Vagas Padrão</label>
              <Input 
                required type="number" min="1"
                className="font-black text-info focus-visible:ring-info" 
                value={novaModalidade.capacidade_padrao} onChange={e => setNovaModalidade({...novaModalidade, capacidade_padrao: e.target.value})} 
              />
            </div>
          </div>

          <Surface variant="subtle" className="border border-border p-6 rounded-3xl">
            <div className="flex justify-between items-end mb-4">
               <div>
                 <h4 className="font-bold text-foreground flex items-center gap-2 text-sm"><DollarSign size={16}/> Divisão de Repasses (%)</h4>
                 <p className="text-xs text-muted-foreground font-medium mt-1">A soma deve ser obrigatoriamente 100%.</p>
               </div>
               <div className={`text-xl font-black ${isNovaValida ? 'text-success' : 'text-destructive'}`}>
                 Total: {totalTaxasNova}%
               </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black text-info uppercase block mb-1">Professor</label>
                <Input type="number" min="0" max="100" className="text-center font-black focus-visible:ring-info" value={novaModalidade.taxa_professor} onChange={e => setNovaModalidade({...novaModalidade, taxa_professor: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black text-warning uppercase block mb-1">Espaço (Caixa)</label>
                <Input type="number" min="0" max="100" className="text-center font-black focus-visible:ring-warning" value={novaModalidade.taxa_espaco} onChange={e => setNovaModalidade({...novaModalidade, taxa_espaco: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black text-purple uppercase block mb-1">Diretor</label>
                <Input type="number" min="0" max="100" className="text-center font-black focus-visible:ring-purple" value={novaModalidade.taxa_direcao} onChange={e => setNovaModalidade({...novaModalidade, taxa_direcao: e.target.value})} />
              </div>
            </div>
          </Surface>

          <div className="flex justify-end">
             <Button type="submit" variant="brand" size="lg" disabled={creating || !isNovaValida} className="w-full md:w-auto font-black flex gap-3">
               {creating ? <RefreshCw className="animate-spin" size={24}/> : <Plus size={24}/>} Salvar Modalidade
             </Button>
          </div>
        </form>
      </Surface>

      {/* GRADE MODALIDADES */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingList ? (
           [1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-3xl animate-pulse" />)
        ) : modalidades.map(mod => (
          <Surface 
            key={mod.id} 
            variant="card"
            padding="md"
            onClick={() => abrirPerfil(mod)}
            className="flex justify-between items-center hover:border-primary/30 hover:-translate-y-1 cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 bg-primary-soft rounded-2xl text-primary flex items-center justify-center">
                 <Activity size={24}/>
               </div>
               <div>
                 <div className="flex items-center gap-2 mb-0.5">
                   <h3 className="font-bold text-foreground leading-none">{mod.nome}</h3>
                   <span className={`px-2 py-0.5 border rounded-lg text-[9px] font-black uppercase tracking-wider ${getAreaColor(mod.area)}`}>
                     {mod.area || 'Dança'}
                   </span>
                 </div>
                 <p className="text-xs font-medium text-muted-foreground flex items-center gap-2 mt-1">
                   <span className="flex items-center gap-1"><Users size={12} className="text-info"/> {mod.capacidade_padrao || 15} vagas</span>
                 </p>
               </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
              <button onClick={(e) => abrirEdicao(mod, e)} className="p-3 text-muted-foreground hover:text-info hover:bg-info-soft rounded-xl transition-all" title="Editar">
                <Edit2 size={18}/>
              </button>
              <button onClick={(e) => excluirModalidade(mod.id, e)} disabled={deletingId === mod.id} className="p-3 text-muted-foreground hover:text-destructive hover:bg-destructive-soft rounded-xl transition-all" title="Excluir">
                  {deletingId === mod.id ? <RefreshCw className="animate-spin text-destructive" size={18}/> : <Trash2 size={18}/>}
              </button>
            </div>
          </Surface>
        ))}
      </div>

      <Modal isOpen={modalPerfilAberto} onClose={() => setModalPerfilAberto(false)} titulo="Raio-X da Turma">
        {modPerfil && (
          <div className="space-y-6 pt-2 max-h-[70vh] overflow-y-auto custom-scrollbar pr-2">
            
            <div className="bg-card border border-border p-6 rounded-3xl flex justify-between items-center relative overflow-hidden">
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-black text-foreground">{modPerfil.nome}</h2>
                      <span className={`px-2 py-1 border rounded-lg text-[10px] font-black uppercase tracking-wider ${getAreaColor(modPerfil.area)}`}>
                        {modPerfil.area || 'Dança'}
                      </span>
                    </div>
                    <p className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                        <Users size={16} className="text-info"/> {modPerfil.capacidade_padrao || 15} vagas por aula
                    </p>
                </div>
                <button onClick={() => abrirEdicao(modPerfil)} className="relative z-10 bg-subtle hover:bg-muted text-foreground p-3 rounded-xl transition-all border border-border" title="Editar Configurações">
                    <Edit2 size={20} />
                </button>
                <div className="absolute -right-8 -top-8 text-muted/5 rotate-12">
                    <Activity size={120} />
                </div>
            </div>

            {loadingPerfil ? (
                <div className="flex justify-center py-10"><RefreshCw className="animate-spin text-muted-foreground" size={32} /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Surface variant="subtle" className="border border-border p-5 rounded-3xl">
                        <h4 className="font-bold text-foreground flex items-center gap-2 mb-4">
                            <Users size={18} className="text-info"/> Alunos Ativos ({dadosPerfil.alunos.length})
                        </h4>
                        
                        {dadosPerfil.alunos.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Nenhum aluno vinculado no momento.</p>
                        ) : (
                            <ul className="space-y-2">
                                {dadosPerfil.alunos.map(aluno => (
                                    <li key={aluno.id} className="bg-card p-3 rounded-xl border border-border shadow-sm flex items-center justify-between">
                                        <span className="font-bold text-sm text-foreground">{aluno.nome_completo}</span>
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-info bg-info-soft px-2 py-1 rounded-md">{aluno.planos?.nome || 'Sem plano'}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Surface>

                    <div className="flex flex-col gap-4">
                        <Surface variant="card" className="p-5 rounded-3xl flex-1">
                            <h4 className="font-bold text-foreground flex items-center gap-2 mb-4"><Clock size={18} className="text-purple"/> Horários na Grade</h4>
                            {dadosPerfil.horarios.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">Não há aulas recorrentes cadastradas no calendário.</p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {dadosPerfil.horarios.map((h, i) => (
                                        <li key={i} className="bg-purple-soft text-purple border border-purple/20 px-3 py-3 rounded-xl text-sm font-bold flex items-center gap-3">
                                            <Calendar size={16} /> {h.dia_semana}, {h.horario.slice(0,5)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Surface>

                        <Surface variant="subtle" className="border border-border p-5 rounded-3xl">
                            <h4 className="font-bold text-foreground flex items-center gap-2 mb-3 text-sm"><DollarSign size={16}/> Regras de Repasse</h4>
                            <div className="flex gap-2">
                                <div className="flex-1 bg-card border border-border p-2 rounded-xl text-center shadow-sm">
                                    <span className="block text-[10px] font-black text-info uppercase">Prof</span>
                                    <span className="text-sm font-black text-foreground">{modPerfil.taxa_professor || 0}%</span>
                                </div>
                                <div className="flex-1 bg-card border border-border p-2 rounded-xl text-center shadow-sm">
                                    <span className="block text-[10px] font-black text-warning uppercase">Caixa</span>
                                    <span className="text-sm font-black text-foreground">{modPerfil.taxa_espaco || 0}%</span>
                                </div>
                                <div className="flex-1 bg-card border border-border p-2 rounded-xl text-center shadow-sm">
                                    <span className="block text-[10px] font-black text-purple uppercase">Dir</span>
                                    <span className="text-sm font-black text-foreground">{modPerfil.taxa_direcao || 0}%</span>
                                </div>
                            </div>
                        </Surface>
                    </div>
                </div>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={modalEdicaoAberto} onClose={() => setModalEdicaoAberto(false)} titulo="Editar Configurações">
        {modalidadeEmEdicao && (
          <form onSubmit={handleSalvarEdicao} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="w-full">
                  <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Nome</label>
                  <Input 
                      required 
                      value={modalidadeEmEdicao.nome} 
                      onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, nome: e.target.value})} 
                  />
                </div>

                <div className="w-full">
                  <label className="text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-1"><Tag size={12}/> Área / Categoria</label>
                  <Input as="select"
                    value={modalidadeEmEdicao.area}
                    onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, area: e.target.value})}
                  >
                    <option value="Dança">Dança</option>
                    <option value="Funcional">Funcional</option>
                    <option value="Livre/Todos">Livre / Outros</option>
                  </Input>
                </div>
                
                <div className="w-full">
                  <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Professor Fixo</label>
                  <Input as="select"
                      value={modalidadeEmEdicao.professor_id}
                      onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, professor_id: e.target.value})}
                  >
                      <option value="">Sem professor</option>
                      {professores.map(prof => (
                      <option key={prof.id} value={prof.id}>{prof.nome}</option>
                      ))}
                  </Input>
                </div>

                <div className="w-full">
                  <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Vagas Padrão</label>
                  <Input 
                    required type="number" min="1"
                    className="font-black text-info focus-visible:ring-info" 
                    value={modalidadeEmEdicao.capacidade_padrao} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, capacidade_padrao: e.target.value})} 
                  />
                </div>
            </div>

            <Surface variant="subtle" className="border border-border p-4 rounded-2xl">
                <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-black text-muted-foreground uppercase block">Divisão da Comissão</label>
                    <span className={`text-xs font-black ${isEdicaoValida ? 'text-success' : 'text-destructive'}`}>Total: {totalTaxasEdicao}%</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <span className="text-[10px] uppercase font-bold text-info mb-1 block">Prof</span>
                        <Input type="number" className="text-center font-bold focus-visible:ring-info" value={modalidadeEmEdicao.taxa_professor} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, taxa_professor: e.target.value})} />
                    </div>
                    <div>
                        <span className="text-[10px] uppercase font-bold text-warning mb-1 block">Espaço</span>
                        <Input type="number" className="text-center font-bold focus-visible:ring-warning" value={modalidadeEmEdicao.taxa_espaco} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, taxa_espaco: e.target.value})} />
                    </div>
                    <div>
                        <span className="text-[10px] uppercase font-bold text-purple mb-1 block">Diretor</span>
                        <Input type="number" className="text-center font-bold focus-visible:ring-purple" value={modalidadeEmEdicao.taxa_direcao} onChange={e => setModalidadeEmEdicao({...modalidadeEmEdicao, taxa_direcao: e.target.value})} />
                    </div>
                </div>
                {!isEdicaoValida && <p className="text-[10px] font-bold text-destructive mt-2 flex items-center gap-1"><AlertCircle size={12}/> A soma das 3 partes deve dar 100%.</p>}
            </Surface>

            <Button type="submit" variant="brand" disabled={savingEdit || !isEdicaoValida} className="w-full font-black text-lg gap-2">
              {savingEdit ? <RefreshCw className="animate-spin" size={20}/> : "Salvar Alterações"}
            </Button>
          </form>
        )}
      </Modal>

    </div>
  );
}