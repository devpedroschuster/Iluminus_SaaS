import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Edit2, ShieldAlert, RefreshCw, Mail, Phone, CreditCard, User } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Serviços
import { professoresService } from '../services/professoresService';
import { useDebounce } from '../hooks/useDebounce';

// Componentes
import { showToast } from '../components/shared/Toast';
import Modal, { ModalConfirmacao, useModal } from '../components/shared/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';

export default function Professores() {
  const [professores, setProfessores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  
  const [formProfessor, setFormProfessor] = useState({ 
    id: null, nome: '', email: '', telefone: '', pix_comissao: '', auth_id: null 
  });
  const [profSelecionado, setProfSelecionado] = useState(null);
  const [saving, setSaving] = useState(false);

  const buscaDebounced = useDebounce(busca, 400);
  const modalForm = useModal();
  const modalStatus = useModal();

  const SENHA_PADRAO = "Iluminus576";

  useEffect(() => {
    carregarProfessores();
  }, [buscaDebounced]);

  async function carregarProfessores() {
    setLoading(true);
    try {
      const data = await professoresService.listar(buscaDebounced);
      setProfessores(data);
    } catch (error) {
      showToast.error("Erro ao carregar lista.");
    } finally {
      setLoading(false);
    }
  }

  function prepararEdicao(prof) {
    setFormProfessor({
      id: prof.id,
      nome: prof.nome,
      email: prof.email || '',
      telefone: prof.telefone || '',
      pix_comissao: prof.pix_comissao || '',
      auth_id: prof.auth_id || null
    });
    modalForm.abrir();
  }

  async function handleSalvar(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      let auth_id = formProfessor.auth_id;

      // LÓGICA DE CRIAÇÃO DE PERFIL DE ACESSO (AUTH)
      // Se tem e-mail e ainda não tem um perfil de acesso criado
      if (formProfessor.email && !auth_id) {
        const supabaseFantasma = createClient(supabase.supabaseUrl, supabase.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });

        const { data: authData, error: authError } = await supabaseFantasma.auth.signUp({
          email: formProfessor.email,
          password: SENHA_PADRAO,
          options: { 
            data: { 
              role: 'professor', 
              nome_completo: formProfessor.nome 
            } 
          }
        });

        if (authError) {
          if (authError.message === 'User already registered') {
             // Se o usuário já existe no Auth mas não estava vinculado aqui, 
             // em um sistema real buscaríamos o ID, mas por segurança vamos avisar.
             throw new Error("Este e-mail já possui um acesso criado no sistema.");
          }
          throw authError;
        }

        auth_id = authData.user.id;
        showToast.success("Perfil de acesso criado para o professor!");
      }

      // Salva ou Atualiza no banco de dados
      await professoresService.salvar({ ...formProfessor, auth_id });
      
      showToast.success(formProfessor.id ? "Dados atualizados!" : "Professor cadastrado!");
      modalForm.fechar();
      carregarProfessores();
    } catch (error) {
      showToast.error(error.message || "Erro ao salvar professor.");
    } finally {
      setSaving(false);
    }
  }

  async function alternarStatus() {
    try {
      await professoresService.alternarStatus(profSelecionado.id, !profSelecionado.ativo);
      showToast.success(profSelecionado.ativo ? "Professor desativado." : "Professor reativado!");
      modalStatus.fechar();
      carregarProfessores();
    } catch (error) {
      showToast.error("Erro ao alterar status.");
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-800">Equipe de Professores</h1>
          <p className="text-gray-500">Gerencie os profissionais e seus acessos ao sistema.</p>
        </div>
        <button 
          onClick={() => { setFormProfessor({ id: null, nome: '', email: '', telefone: '', pix_comissao: '', auth_id: null }); modalForm.abrir(); }}
          className="bg-purple-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-purple-100 hover:scale-[1.02] transition-all"
        >
          <UserPlus size={20} /> Novo Professor
        </button>
      </div>

      <div className="bg-white p-4 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-4">
        <Search className="text-gray-400 ml-2" size={20} />
        <input 
          type="text" 
          placeholder="Buscar por nome..." 
          className="flex-1 outline-none font-medium text-gray-600 bg-transparent"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <TableSkeleton />
        ) : professores.length === 0 ? (
          <div className="col-span-full">
            <EmptyState titulo="Nenhum professor encontrado" mensagem="Comece cadastrando seu primeiro professor." />
          </div>
        ) : (
          professores.map(prof => (
            <div key={prof.id} className={`bg-white p-6 rounded-[32px] border transition-all hover:shadow-md group ${!prof.ativo ? 'opacity-60 grayscale' : 'border-gray-100'}`}>
              <div className="flex justify-between items-start mb-6">
                <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 font-black text-2xl">
                  {prof.nome.charAt(0)}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => prepararEdicao(prof)} className="p-3 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-xl transition-all">
                    <Edit2 size={18} />
                  </button>
                  <button 
                    onClick={() => { setProfSelecionado(prof); modalStatus.abrir(); }}
                    className={`p-3 rounded-xl transition-all ${prof.ativo ? 'text-gray-400 hover:text-red-500 hover:bg-red-50' : 'text-red-500 bg-red-50'}`}
                  >
                    <ShieldAlert size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className="font-black text-xl text-gray-800 leading-tight">{prof.nome}</h3>
                <p className="text-gray-400 text-sm font-medium flex items-center gap-2">
                  <Mail size={14} className="text-purple-300"/> {prof.email || 'E-mail não cadastrado'}
                </p>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-50 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Status</span>
                  <span className={`text-xs font-bold ${prof.ativo ? 'text-green-500' : 'text-red-500'}`}>
                    {prof.ativo ? '● Ativo no Sistema' : '● Desativado'}
                  </span>
                </div>
                {prof.auth_id && (
                  <div className="bg-blue-50 text-blue-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase">
                    Com Acesso
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal de Cadastro/Edição */}
      <Modal isOpen={modalForm.isOpen} onClose={modalForm.fechar} titulo={formProfessor.id ? "Editar Professor" : "Cadastrar Professor"}>
        <form onSubmit={handleSalvar} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-2">Nome Completo</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
              <input 
                required placeholder="Nome do Professor" 
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all font-bold text-gray-700" 
                value={formProfessor.nome} 
                onChange={e => setFormProfessor({...formProfessor, nome: e.target.value})} 
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-2">E-mail (Criará o acesso automaticamente)</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
              <input 
                type="email" placeholder="email@exemplo.com" 
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all font-bold text-gray-700" 
                value={formProfessor.email} 
                onChange={e => setFormProfessor({...formProfessor, email: e.target.value})} 
              />
            </div>
            {!formProfessor.auth_id && formProfessor.email && (
              <p className="text-[10px] text-purple-500 font-bold px-2 italic">* Ao salvar, uma conta será criada com a senha: {SENHA_PADRAO}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase ml-2">Telefone</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <input 
                  placeholder="(00) 00000-0000" 
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all font-bold text-gray-700" 
                  value={formProfessor.telefone} 
                  onChange={e => setFormProfessor({...formProfessor, telefone: e.target.value})} 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase ml-2">Chave PIX</label>
              <div className="relative">
                <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <input 
                  placeholder="Para repasses" 
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all font-bold text-gray-700" 
                  value={formProfessor.pix_comissao} 
                  onChange={e => setFormProfessor({...formProfessor, pix_comissao: e.target.value})} 
                />
              </div>
            </div>
          </div>

          <button disabled={saving} className="w-full bg-purple-600 text-white py-5 rounded-[22px] font-black shadow-lg hover:scale-[1.01] transition-all flex items-center justify-center gap-2 mt-4">
            {saving ? <RefreshCw className="animate-spin" size={24}/> : null}
            {saving ? "Processando..." : (formProfessor.id ? "Atualizar Cadastro" : "Concluir e Criar Acesso")}
          </button>
        </form>
      </Modal>

      <ModalConfirmacao 
        isOpen={modalStatus.isOpen}
        onClose={modalStatus.fechar}
        onConfirm={alternarStatus}
        titulo={profSelecionado?.ativo ? "Desativar Professor?" : "Reativar Professor?"}
        mensagem={`Tem certeza que deseja ${profSelecionado?.ativo ? 'desativar' : 'reativar'} o acesso de ${profSelecionado?.nome}?`}
      />
    </div>
  );
}