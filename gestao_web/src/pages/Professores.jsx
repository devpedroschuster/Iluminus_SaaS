import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Edit2, ShieldAlert, RefreshCw, Mail, Phone, CreditCard, User } from 'lucide-react';
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

  function abrirModalCriar() {
    setFormProfessor({ id: null, nome: '', email: '', telefone: '', pix_comissao: '', auth_id: null });
    modalForm.abrir();
  }

  function abrirModalEditar(prof) {
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
      let isNovoAcesso = false;
      let payloadProfessor = { ...formProfessor };

      if (payloadProfessor.email && !payloadProfessor.auth_id) {
        
        const { data: funcData, error: funcError } = await supabase.functions.invoke('criar_usuario', {
          body: { email: payloadProfessor.email, nome: payloadProfessor.nome, role: 'professor' }
        });

        if (funcError) throw new Error("Falha na comunicação com o servidor seguro.");
        
        if (funcData?.error) {
           throw new Error(funcData.error === 'User already registered' 
             ? 'Este e-mail já possui um acesso no sistema.' 
             : funcData.error);
        }

        payloadProfessor.auth_id = funcData.user.id;
        isNovoAcesso = true;
      }

      await professoresService.salvar(payloadProfessor);
      
      showToast.success(isNovoAcesso 
        ? "Professor cadastrado e Acesso criado!" 
        : "Professor atualizado com sucesso!");
        
      modalForm.fechar();
      carregarProfessores();
    } catch (error) {
       showToast.error(error.message || "Erro ao salvar dados.");
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800">Equipe de Professores</h1>
          <p className="text-gray-500">Gerencie os profissionais e seus acessos ao sistema.</p>
        </div>
        <button 
          onClick={abrirModalCriar}
          className="bg-purple-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-purple-100 hover:scale-[1.02] transition-all"
        >
          <UserPlus size={20} /> Novo Professor
        </button>
      </div>

      <div className="flex flex-wrap gap-4 bg-white p-4 rounded-[28px] border border-gray-100 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
          <input 
            type="text"
            placeholder="Pesquisar por nome do professor..."
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl outline-none font-medium text-gray-600"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : professores.length > 0 ? (
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400 tracking-widest">
              <tr>
                <th className="px-8 py-6">Professor</th>
                <th className="px-8 py-6">Contato</th>
                <th className="px-8 py-6">Chave PIX</th>
                <th className="px-8 py-6">Status</th>
                <th className="px-8 py-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {professores.map((prof) => (
                <tr key={prof.id} className="group hover:bg-gray-50/50 transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center font-black text-purple-600">
                        {prof.nome.charAt(0)}
                      </div>
                      <div>
                         <p className="font-bold text-gray-800">{prof.nome}</p>
                         {prof.auth_id && <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded font-black uppercase mt-1 inline-block">Com Acesso</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-xs font-bold text-gray-600 block">{prof.telefone || 'Sem telefone'}</span>
                    <span className="text-[10px] font-medium text-gray-400">{prof.email || 'Sem e-mail'}</span>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-xs font-black text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200">
                      {prof.pix_comissao || 'Não cadastrada'}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${prof.ativo ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${prof.ativo ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-[10px] font-black uppercase">{prof.ativo ? 'Ativo' : 'Inativo'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => abrirModalEditar(prof)} className="p-2 text-gray-300 hover:text-purple-600 transition-colors bg-white rounded-lg shadow-sm border border-gray-100 hover:border-purple-200">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => { setProfSelecionado(prof); modalStatus.abrir(); }} className="p-2 text-gray-300 hover:text-orange-600 transition-colors bg-white rounded-lg shadow-sm border border-gray-100 hover:border-orange-200">
                        <ShieldAlert size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-20">
            <EmptyState titulo="Nenhum professor encontrado" mensagem="Comece cadastrando seu primeiro professor." />
          </div>
        )}
      </div>

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
            <label className="text-[10px] font-black text-gray-400 uppercase ml-2">E-mail (Gera acesso automático)</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
              <input 
                type="email" placeholder="email@exemplo.com" 
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all font-bold text-gray-700" 
                value={formProfessor.email} 
                onChange={e => setFormProfessor({...formProfessor, email: e.target.value})} 
              />
            </div>
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
            {saving ? "Processando Seguro..." : (formProfessor.id ? "Atualizar Cadastro" : "Concluir e Criar Acesso")}
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