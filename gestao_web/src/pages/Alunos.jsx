import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, Search, UserPlus, MoreVertical 
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

export default function Alunos() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [filtroRole, setFiltroRole] = useState('todos');
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  
  const buscaDebounced = useDebounce(busca, 400);
  const modalStatus = useModal();

  // Hook de dados (React Query)
  const { alunos, loading, refetch } = useAlunos({ 
    role: filtroRole, 
    busca: buscaDebounced 
  });

  // Função otimizada com useCallback
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

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Comunidade</h1>
          <p className="text-gray-500 font-medium text-sm">Gerencie alunos e colaboradores do Espaço Iluminus.</p>
        </div>
        <button 
          onClick={() => navigate('/alunos/novo')}
          className="bg-iluminus-terracota text-white px-6 py-4 rounded-[22px] font-black shadow-lg shadow-orange-100 hover:scale-[1.02] transition-all flex items-center gap-2"
        >
          <UserPlus size={20} /> Novo Membro
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-4 bg-white p-4 rounded-[28px] border border-gray-100 shadow-sm">
        <div className="relative flex-1 min-w-[300px]">
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
          className="bg-gray-50 px-6 py-3 rounded-2xl font-bold text-sm text-gray-600 outline-none cursor-pointer"
          value={filtroRole}
          onChange={(e) => setFiltroRole(e.target.value)}
        >
          <option value="todos">Todos os Cargos</option>
          <option value="aluno">Alunos</option>
          <option value="professor">Professores</option>
          <option value="admin">Administradores</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : alunos.length > 0 ? (
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400 tracking-widest">
              <tr>
                <th className="px-8 py-6">Membro</th>
                <th className="px-8 py-6">Plano / Cargo</th>
                <th className="px-8 py-6">Status</th>
                <th className="px-8 py-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {alunos.map((aluno) => (
                <tr key={aluno.id} className="group hover:bg-gray-50/50 transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center font-black text-iluminus-terracota">
                        {aluno.nome_completo?.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">{aluno.nome_completo}</p>
                        <p className="text-xs text-gray-400 font-medium">{aluno.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-xs font-bold text-gray-600 block">{aluno.planos?.nome || 'Sem Plano'}</span>
                    <span className="text-[10px] font-black uppercase text-gray-300">{aluno.role}</span>
                  </td>
                  <td className="px-8 py-6">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${aluno.ativo ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${aluno.ativo ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-[10px] font-black uppercase">{aluno.ativo ? 'Ativo' : 'Inativo'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button 
                      onClick={() => { setAlunoSelecionado(aluno); modalStatus.abrir(); }}
                      className="p-2 text-gray-300 hover:text-gray-700 transition-colors"
                    >
                      <MoreVertical size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState 
            titulo="Nenhum resultado encontrado" 
            mensagem={busca ? `Não encontramos ninguém com "${busca}".` : "Lista vazia."} 
          />
        )}
      </div>

      <ModalConfirmacao 
        isOpen={modalStatus.isOpen}
        onClose={modalStatus.fechar}
        onConfirm={alternarStatus}
        titulo={alunoSelecionado?.ativo ? "Desativar Membro?" : "Reativar Membro?"}
        mensagem={`Confirmar alteração para ${alunoSelecionado?.nome_completo}?`}
        tipo={alunoSelecionado?.ativo ? "danger" : "primary"}
      />
    </div>
  );
}