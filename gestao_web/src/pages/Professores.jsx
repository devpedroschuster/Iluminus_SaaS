import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Edit2, ShieldAlert, RefreshCw } from 'lucide-react';

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
  
  const [formProfessor, setFormProfessor] = useState({ id: null, nome: '', email: '', telefone: '', pix_comissao: '' });
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
      const dados = await professoresService.listar(buscaDebounced);
      setProfessores(dados || []);
    } catch (error) {
      showToast.error("Erro ao carregar professores.");
    } finally {
      setLoading(false);
    }
  }

  function abrirModalCriar() {
    setFormProfessor({ id: null, nome: '', email: '', telefone: '', pix_comissao: '' });
    modalForm.abrir();
  }

  function abrirModalEditar(prof) {
    setFormProfessor({ 
      id: prof.id, 
      nome: prof.nome, 
      email: prof.email || '', 
      telefone: prof.telefone || '', 
      pix_comissao: prof.pix_comissao || '' 
    });
    modalForm.abrir();
  }

  async function salvarProfessor(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      await professoresService.salvar(formProfessor);
      showToast.success(formProfessor.id ? "Professor atualizado!" : "Professor cadastrado com sucesso!");
      modalForm.fechar();
      carregarProfessores();
    } catch (error) {
      if (error.message?.includes('unique')) {
        showToast.error("Já existe um professor com este e-mail.");
      } else {
        showToast.error("Erro ao salvar professor.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function alternarStatus() {
    if (!profSelecionado) return;
    try {
      const novoStatus = !profSelecionado.ativo;
      await professoresService.alterarStatus(profSelecionado.id, novoStatus);
      showToast.success(`Professor ${novoStatus ? 'reativado' : 'desativado'} com sucesso!`);
      modalStatus.fechar();
      carregarProfessores();
    } catch (error) {
      showToast.error("Erro ao alterar status.");
    }
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Professores</h1>
          <p className="text-gray-500 font-medium text-sm">Gerencie o corpo docente e os dados de comissão.</p>
        </div>
        <button 
          onClick={abrirModalCriar}
          className="bg-purple-600 text-white px-6 py-4 rounded-[22px] font-black shadow-lg shadow-purple-200 hover:scale-[1.02] transition-all flex items-center gap-2"
        >
          <UserPlus size={20} /> Novo Professor
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-4 bg-white p-4 rounded-[28px] border border-gray-100 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
          <input 
            type="text"
            placeholder="Pesquisar por nome do professor..."
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl outline-none font-medium"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
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
                      <p className="font-bold text-gray-800">{prof.nome}</p>
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
          <EmptyState 
            titulo="Nenhum professor encontrado" 
            mensagem={busca ? `Não encontramos ninguém com "${busca}".` : "Cadastre o primeiro professor para começar."} 
          />
        )}
      </div>

      {/* Modal Formulário */}
      <Modal isOpen={modalForm.isOpen} onClose={modalForm.fechar} titulo={formProfessor.id ? "Editar Professor" : "Novo Professor"}>
        <form onSubmit={salvarProfessor} className="space-y-4 pt-2">
          <input 
            placeholder="Nome Completo" 
            className="w-full p-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all" 
            required 
            value={formProfessor.nome} 
            onChange={e => setFormProfessor({...formProfessor, nome: e.target.value})} 
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input 
              type="email"
              placeholder="E-mail (Opcional)" 
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all" 
              value={formProfessor.email} 
              onChange={e => setFormProfessor({...formProfessor, email: e.target.value})} 
            />
            <input 
              placeholder="Telefone (Opcional)" 
              className="w-full p-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all" 
              value={formProfessor.telefone} 
              onChange={e => setFormProfessor({...formProfessor, telefone: e.target.value})} 
            />
          </div>
          <input 
            placeholder="Chave PIX (Para comissões)" 
            className="w-full p-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-purple-100 transition-all" 
            value={formProfessor.pix_comissao} 
            onChange={e => setFormProfessor({...formProfessor, pix_comissao: e.target.value})} 
          />
          <button disabled={saving} className="w-full bg-purple-600 text-white py-4 rounded-2xl font-black shadow-lg hover:scale-[1.01] transition-all flex items-center justify-center gap-2 mt-2">
            {saving ? <RefreshCw className="animate-spin" size={20}/> : null}
            {saving ? "Salvando..." : "Salvar Dados"}
          </button>
        </form>
      </Modal>

      {/* Modal Status */}
      <ModalConfirmacao 
        isOpen={modalStatus.isOpen}
        onClose={modalStatus.fechar}
        onConfirm={alternarStatus}
        titulo={profSelecionado?.ativo ? "Desativar Professor?" : "Reativar Professor?"}
        mensagem={`Tem certeza que deseja alterar o status de ${profSelecionado?.nome}? Ele(a) não aparecerá na criação de novas aulas se for desativado(a).`}
        tipo={profSelecionado?.ativo ? "danger" : "primary"}
      />
    </div>
  );
}