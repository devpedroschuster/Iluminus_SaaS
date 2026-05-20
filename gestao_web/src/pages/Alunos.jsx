import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, UserPlus, Edit2, ShieldAlert, Trash2, Package
} from 'lucide-react';

// Serviços e Hooks
import { alunosService } from '../services/alunosService';
import { useDebounce } from '../hooks/useDebounce';
import { useAlunos } from '../hooks/useAlunos';

// Design System
import Surface from '../components/ui/Surface';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

// Componentes
import { showToast } from '../components/shared/Toast';
import { ModalConfirmacao, useModal } from '../components/ui/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import ModalMatricula from '../components/ModalMatricula';

export default function Alunos() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [filtroRole, setFiltroRole] = useState('todos');

  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const [modalMatriculaAberto, setModalMatriculaAberto] = useState(false);

  const buscaDebounced = useDebounce(busca, 400);

  const modalStatus = useModal();
  const modalExcluir = useModal();

  const { alunos, loading, refetch } = useAlunos({
    role: filtroRole,
    busca: buscaDebounced,
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
      showToast.error('Erro ao alterar status.');
    }
  }, [alunoSelecionado, modalStatus, refetch]);

  const excluirAluno = useCallback(async () => {
    if (!alunoSelecionado) return;
    try {
      await alunosService.excluir(alunoSelecionado.id);
      showToast.success('Membro excluído permanentemente!');
      modalExcluir.fechar();
      refetch();
    } catch (err) {
      if (err.message?.includes('violates foreign key constraint')) {
        showToast.error('Não é possível excluir: este aluno já possui histórico financeiro ou presenças. Utilize a opção de Desativar.');
      } else {
        showToast.error('Erro ao excluir aluno.');
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
          <h1 className="text-3xl font-black text-foreground tracking-tight">Alunos</h1>
          <p className="text-muted-foreground font-medium text-sm">
            Gerencie os alunos matriculados no Espaço Iluminus.
          </p>
        </div>

        {/* ✅ Substituído por <Button> do DS — bg-primary + restante do visual já embutidos no variant="brand" */}
        <Button
          variant="brand"
          size="lg"
          leftIcon={<UserPlus size={20} />}
          onClick={() => navigate('/alunos/novo')}
          className="w-full md:w-auto rounded-[22px] hover:scale-[1.02]"
        >
          Novo Aluno
        </Button>
      </div>

      {/* Filtros */}
      <Surface variant="card" padding="md" className="flex flex-col md:flex-row gap-4 w-full">
        <Input
          wrapperClassName="flex-1 w-full"
          leftIcon={<Search size={18} />}
          placeholder="Pesquisar por nome ou e-mail..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <select
          className="w-full md:w-auto bg-muted px-6 py-3 rounded-2xl font-bold text-sm text-muted-foreground outline-none cursor-pointer hover:bg-subtle transition-colors"
          value={filtroRole}
          onChange={(e) => setFiltroRole(e.target.value)}
        >
          <option value="todos">Todos (Alunos e Admins)</option>
          <option value="aluno">Alunos</option>
          <option value="admin">Administradores</option>
        </select>
      </Surface>

      {/* Tabela */}
      <Surface variant="card" padding="none" className="overflow-hidden w-full">
        {loading ? (
          <TableSkeleton />
        ) : alunos.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left min-w-[800px]">
              <thead className="bg-muted text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                <tr>
                  <th className="px-6 md:px-8 py-4 md:py-6">Membro</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">Plano / Cargo</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">Status</th>
                  <th className="px-6 md:px-8 py-4 md:py-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {alunos.map((aluno) => (
                  <tr
                    key={aluno.id}
                    className="group hover:bg-subtle transition-colors"
                  >
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
                            className="w-10 h-10 rounded-full object-cover border border-border shadow-sm"
                          />
                        ) : (
                          // ✅ bg-orange-100 → bg-primary-soft (token DS)
                          <div className="w-10 h-10 bg-primary-soft rounded-full flex items-center justify-center font-black text-primary">
                            {aluno.nome_completo?.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-foreground hover:text-primary transition-colors">
                            {aluno.nome_completo}
                          </p>
                          <p className="text-xs text-muted-foreground font-medium">
                            {aluno.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 md:px-8 py-4 md:py-6">
                      <span className="text-xs font-bold text-foreground block">
                        {aluno.planos?.nome || 'Sem Plano'}
                      </span>
                      <span className="text-[10px] font-black uppercase text-muted-foreground">
                        {aluno.role}
                      </span>
                    </td>
                    <td className="px-6 md:px-8 py-4 md:py-6">
                      <div
                        className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${
                          aluno.ativo
                            ? 'bg-success-soft text-success'
                            : 'bg-destructive-soft text-destructive'
                        }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            aluno.ativo ? 'bg-success' : 'bg-destructive'
                          }`}
                        />
                        <span className="text-[10px] font-black uppercase">
                          {aluno.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 md:px-8 py-4 md:py-6 text-right">
                      <div className="flex justify-end gap-2">
                        {/* ✅ hover:text-green-600 → hover:text-success | hover:border-green-200 → hover:border-success/30 */}
                        <button
                          onClick={() => {
                            setAlunoSelecionado(aluno);
                            setModalMatriculaAberto(true);
                          }}
                          className="p-2 text-muted-foreground hover:text-success transition-colors bg-card rounded-lg shadow-sm border border-border hover:border-success/30 hover:bg-subtle"
                          title="Matricular/Alterar Plano"
                        >
                          <Package size={16} />
                        </button>

                        <button
                          onClick={() => handleEditar(aluno)}
                          className="p-2 text-muted-foreground hover:text-info transition-colors bg-card rounded-lg shadow-sm border border-border hover:border-info/30 hover:bg-subtle"
                          title="Editar"
                        >
                          <Edit2 size={16} />
                        </button>

                        {/* ✅ hover:text-orange-600 → hover:text-primary (token DS) */}
                        <button
                          onClick={() => {
                            setAlunoSelecionado(aluno);
                            modalStatus.abrir();
                          }}
                          className="p-2 text-muted-foreground hover:text-primary transition-colors bg-card rounded-lg shadow-sm border border-border hover:border-primary/30 hover:bg-subtle"
                          title="Ativar/Desativar"
                        >
                          <ShieldAlert size={16} />
                        </button>

                        <button
                          onClick={() => {
                            setAlunoSelecionado(aluno);
                            modalExcluir.abrir();
                          }}
                          className="p-2 text-muted-foreground hover:text-destructive transition-colors bg-card rounded-lg shadow-sm border border-border hover:border-destructive/30 hover:bg-subtle"
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
            mensagem={busca ? `Não encontramos ninguém com "${busca}".` : 'Lista vazia.'}
          />
        )}
      </Surface>

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
        titulo={alunoSelecionado?.ativo ? 'Desativar Membro?' : 'Reativar Membro?'}
        mensagem={`Confirmar alteração para ${alunoSelecionado?.nome_completo}? O histórico dele será mantido.`}
        tipo={alunoSelecionado?.ativo ? 'danger' : 'primary'}
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