import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, Search, UserPlus, Edit2, ShieldAlert, Trash2, Package 
} from 'lucide-react';

// Serviços e Hooks
import { alunosService } from '../services/alunosService';
import { useDebounce } from '../hooks/useDebounce';
import { useAlunos } from '../hooks/useAlunos';

// Componentes
import { showToast } from '../components/shared/Toast';
import { ModalConfirmacao, useModal } from '../components/shared/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import ModalMatricula from '../components/ModalMatricula';

export default function Alunos() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [filtroRole, setFiltroRole] = useState('todos');
  
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const [modalMatriculaAberto, setModalMatriculaAberto] = useState(false);
  
  const buscaDebounced = useDebounce(busca, 400);
  
  // Modais
  const modalStatus = useModal();
  const modalExcluir = useModal();

  // Hook
  const { alunos, loading, refetch } = useAlunos({ 
    role: filtroRole, 
    busca: buscaDebounced 
  });

  const alternarStatus = useCallback(async () => {
    if (!alunoSelecionado) return;
    try {
      const novoStatus = !alunoSelecionado.ativo;
      await alunosService.alterarStatus(alunoSelecionado.id, novoStatus);
      showToast.success(`Membro ${novoStatus ? 'reativado' : 'desativado'} com sucesso!`);
      modalStatus.fechar();
      refetch(); 
    } catch (err) {
      showToast.error("Erro ao alterar status.");
    }
  }, [alunoSelecionado, modalStatus, refetch]);

  const excluirAluno = useCallback(async () => {
    if (!alunoSelecionado) return;
    try {
      await alunosService.excluir(alunoSelecionado.id);
      showToast.success("Membro excluído permanentemente!");
      modalExcluir.fechar();
      refetch();
    } catch (err) {
      if (err.message?.includes('violates foreign key constraint')) {
        showToast.error("Não é possível excluir: este aluno já possui histórico financeiro ou presenças. Utilize a opção de Desativar.");
      } else {
        showToast.error("Erro ao excluir aluno.");
      }
    }
  }, [alunoSelecionado, modalExcluir, refetch]);

  const handleEditar = (aluno) => {
    navigate('/alunos/novo', { state: { alunoParaEditar: aluno } });
  };

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 animate-in fade-in duration-500 w-full max-w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Alunos</h1>
          <p className="text-gray-500 font-medium text-sm">Gerencie os alunos matriculados no Espaço Iluminus.</p>
        </div>
        <button 
          onClick={() => navigate('/alunos/novo')}
          className="w-full md:w-auto bg-iluminus-terracota text-white px-6 py-4 rounded-[22px] font-black shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
        >
          <UserPlus size={20} /> Novo Aluno
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-[28px] border border-gray-100 shadow-sm w-full">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
          <input 
            type="text"
            placeholder="Pesquisar por nome ou e-mail..."
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl outline-none font-medium"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        
        <select 
          className="w-full md:w-auto bg-gray-50 px-6 py-3 rounded-2xl font-bold text-sm text-gray-600 outline-none cursor-pointer"
          value={filtroRole}
          onChange={(e) => setFiltroRole(e.target.value)}
        >
          <option value="todos">Todos (Alunos e Admins)</option>
          <option value="aluno">Alunos</option>
          <option value="admin">Administradores</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-[24px] md:rounded-[40px] border border-gray-100 shadow-sm overflow-hidden w-full">
        {loading ? (
          <TableSkeleton />
        ) : alunos.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left min-w-[800px]">
              <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                <tr>
                  <th className="px-6 md:px-8 py-4 md:py-6">Membro</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">Plano / Cargo</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">Status</th>
                  <th className="px-6 md:px-8 py-4 md:py-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
              {alunos.map((aluno) => (
                <tr key={aluno.id} className="group hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 md:px-8 py-4 md:py-6">
                    <div 
                      className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => navigate(`/alunos/${aluno.id}`)}
                      title="Ver Perfil do Aluno"
                    >
                      {aluno.avatar_url ? (
                        <img 
                          src={aluno.avatar_url} 
                          alt={aluno.nome_completo} 
                          className="w-10 h-10 rounded-full object-cover border border-gray-200 shadow-sm"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center font-black text-iluminus-terracota">
                          {aluno.nome_completo?.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="font-bold text-gray-800 hover:text-iluminus-terracota transition-colors">{aluno.nome_completo}</p>
                        <p className="text-xs text-gray-400 font-medium">{aluno.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-6">
                    <span className="text-xs font-bold text-gray-600 block">{aluno.planos?.nome || 'Sem Plano'}</span>
                    <span className="text-[10px] font-black uppercase text-gray-300">{aluno.role}</span>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-6">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${aluno.ativo ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${aluno.ativo ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-[10px] font-black uppercase">{aluno.ativo ? 'Ativo' : 'Inativo'}</span>
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-6 text-right">
                    <div className="flex justify-end gap-2">
                      
                      <button 
                        onClick={() => { setAlunoSelecionado(aluno); setModalMatriculaAberto(true); }} 
                        className="p-2 text-gray-300 hover:text-green-600 transition-colors bg-white rounded-lg shadow-sm border border-gray-100 hover:border-green-200" 
                        title="Matricular/Alterar Plano"
                      >
                        <Package size={16} />
                      </button>

                      <button 
                        onClick={() => handleEditar(aluno)} 
                        className="p-2 text-gray-300 hover:text-blue-600 transition-colors bg-white rounded-lg shadow-sm border border-gray-100 hover:border-blue-200" 
                        title="Editar"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => { setAlunoSelecionado(aluno); modalStatus.abrir(); }} 
                        className="p-2 text-gray-300 hover:text-orange-600 transition-colors bg-white rounded-lg shadow-sm border border-gray-100 hover:border-orange-200" 
                        title="Ativar/Desativar"
                      >
                        <ShieldAlert size={16} />
                      </button>
                      <button 
                        onClick={() => { setAlunoSelecionado(aluno); modalExcluir.abrir(); }} 
                        className="p-2 text-gray-300 hover:text-red-600 transition-colors bg-white rounded-lg shadow-sm border border-gray-100 hover:border-red-200" 
                        title="Excluir"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState 
            titulo="Nenhum resultado encontrado" 
            mensagem={busca ? `Não encontramos ninguém com "${busca}".` : "Lista vazia."} 
          />
        )}
      </div>

      {modalMatriculaAberto && (
        <ModalMatricula 
          aluno={alunoSelecionado} 
          onClose={() => setModalMatriculaAberto(false)} 
          onMatriculaSucesso={refetch} 
        />
      )}

      <ModalConfirmacao 
        isOpen={modalStatus.isOpen}
        onClose={modalStatus.fechar}
        onConfirm={alternarStatus}
        titulo={alunoSelecionado?.ativo ? "Desativar Membro?" : "Reativar Membro?"}
        mensagem={`Confirmar alteração para ${alunoSelecionado?.nome_completo}? O histórico dele será mantido.`}
        tipo={alunoSelecionado?.ativo ? "danger" : "primary"}
      />

      <ModalConfirmacao 
        isOpen={modalExcluir.isOpen}
        onClose={modalExcluir.fechar}
        onConfirm={excluirAluno}
        titulo="Excluir Permanentemente?"
        mensagem={`Tem certeza que deseja apagar o registro de ${alunoSelecionado?.nome_completo}? Esta ação não pode ser desfeita.`}
        tipo="danger"
      />
    </div>
  );
}