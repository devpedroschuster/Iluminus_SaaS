import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, UserPlus, Edit2, ShieldAlert, Trash2, Package, Calendar
} from 'lucide-react';

import { alunosService } from '../services/alunosService';
import { useDebounce } from '../hooks/useDebounce';
import { useAlunos } from '../hooks/useAlunos';

import Surface from '../components/ui/Surface';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';

import { showToast } from '../components/shared/Toast';
import { ModalConfirmacao, useModal } from '../components/ui/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import ModalMatricula from '../components/ModalMatricula';

/**
 * Calcula o status de vencimento do plano a partir de data_fim_plano.
 *
 * @param {string|null} dataFim  formato 'YYYY-MM-DD'
 * @returns {{ tone: string, label: string, dias: number|null }}
 */
function calcularStatusVencimento(dataFim) {
  if (!dataFim) {
    return { tone: 'neutral', label: 'Sem data', dias: null };
  }

  // Comparação em UTC puro: evita fusos alterando o dia
  const hoje = new Date();
  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  const [ano, mes, dia] = dataFim.split('-').map(Number);
  const fimUTC = Date.UTC(ano, mes - 1, dia);

  const dias = Math.round((fimUTC - hojeUTC) / (1000 * 60 * 60 * 24));

  const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${String(ano).slice(-2)}`;

  if (dias < 0) {
    const atraso = Math.abs(dias);
    return {
      tone: 'destructive',
      label: dataFormatada,
      dias,
    };
  }

  if (dias <= 7) {
    return {
      tone: 'warning',
      label: dataFormatada,
      dias,
    };
  }

  return {
    tone: 'success',
    label: dataFormatada,
    dias,
  };
}

export default function Alunos() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [filtroRole, setFiltroRole] = useState('aluno');

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
      showToast.success(`Aluno ${novoStatus ? 'reativado' : 'desativado'} com sucesso!`);
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
      showToast.success('Aluno excluído permanentemente!');
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
            <table className="w-full text-left min-w-[900px]">
              <thead className="bg-muted text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                <tr>
                  <th className="px-6 md:px-8 py-4 md:py-6">Aluno</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">Plano / Cargo</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">Status</th>
                  <th className="px-6 md:px-8 py-4 md:py-6">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={11} />
                      Vencimento
                    </span>
                  </th>
                  <th className="px-6 md:px-8 py-4 md:py-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {alunos.map((aluno) => {
                  const vencimento = calcularStatusVencimento(aluno.data_fim_plano);

                  return (
                    <tr
                      key={aluno.id}
                      className="group hover:bg-subtle transition-colors"
                    >
                      {/* ALUNO */}
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

                      {/* Plano / Cargo */}
                      <td className="px-6 md:px-8 py-4 md:py-6">
                        <span className="text-xs font-bold text-foreground block">
                          {aluno.planos?.nome || 'Sem Plano'}
                        </span>
                        <span className="text-[10px] font-black uppercase text-muted-foreground">
                          {aluno.role}
                        </span>
                      </td>

                      {/* Status ativo/inativo */}
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

                      {/* Vencimento do plano */}
                      <td className="px-6 md:px-8 py-4 md:py-6">
                        {aluno.role === 'admin' || !aluno.plano_id ? (
                          <Badge tone="neutral" variant="soft">—</Badge>
                        ) : (
                          <Badge tone={vencimento.tone} variant="soft">
                            {vencimento.label}
                          </Badge>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="px-6 md:px-8 py-4 md:py-6 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditar(aluno)}
                            className="p-2 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary-soft transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={16} />
                          </button>

                          <button
                            onClick={() => {
                              setAlunoSelecionado(aluno);
                              setModalMatriculaAberto(true);
                            }}
                            className="p-2 rounded-xl text-muted-foreground hover:text-info hover:bg-info-soft transition-colors"
                            title="Matricular / Renovar Plano"
                          >
                            <Package size={16} />
                          </button>

                          <button
                            onClick={() => {
                              setAlunoSelecionado(aluno);
                              modalStatus.abrir();
                            }}
                            className={`p-2 rounded-xl transition-colors ${
                              aluno.ativo
                                ? 'text-muted-foreground hover:text-warning hover:bg-warning-soft'
                                : 'text-muted-foreground hover:text-success hover:bg-success-soft'
                            }`}
                            title={aluno.ativo ? 'Desativar' : 'Reativar'}
                          >
                            <ShieldAlert size={16} />
                          </button>

                          <button
                            onClick={() => {
                              setAlunoSelecionado(aluno);
                              modalExcluir.abrir();
                            }}
                            className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive-soft transition-colors"
                            title="Excluir permanentemente"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Search size={40} />}
            title="Nenhum aluno encontrado"
            description="Tente ajustar os filtros ou cadastre um novo aluno."
          />
        )}
      </Surface>

      {/* Modal: Alterar Status */}
      <ModalConfirmacao
        aberto={modalStatus.isOpen}
        fechar={modalStatus.fechar}
        titulo={alunoSelecionado?.ativo ? 'Desativar Aluno' : 'Reativar Aluno'}
        mensagem={
          alunoSelecionado?.ativo
            ? `Deseja desativar ${alunoSelecionado?.nome_completo}? O acesso será revogado.`
            : `Deseja reativar ${alunoSelecionado?.nome_completo}? O acesso será restaurado.`
        }
        textoConfirmar={alunoSelecionado?.ativo ? 'Desativar' : 'Reativar'}
        tipo={alunoSelecionado?.ativo ? 'danger' : 'success'}
        onConfirm={alternarStatus}
      />

      {/* Modal: Excluir */}
      <ModalConfirmacao
        aberto={modalExcluir.isOpen}
        fechar={modalExcluir.fechar}
        titulo="Excluir Aluno Permanentemente"
        mensagem={`Tem certeza que deseja excluir ${alunoSelecionado?.nome_completo}? Esta ação não pode ser desfeita.`}
        textoConfirmar="Excluir"
        tipo="danger"
        onConfirm={excluirAluno}
      />

      {/* Modal: Matrícula / Renovação */}
      {modalMatriculaAberto && alunoSelecionado && (
        <ModalMatricula
          isOpen={modalMatriculaAberto}
          onClose={() => {
            setModalMatriculaAberto(false);
            setAlunoSelecionado(null);
          }}
          aluno={alunoSelecionado}
          onMatriculaSucesso={() => {
            refetch();
            setModalMatriculaAberto(false);
            setAlunoSelecionado(null);
          }}
        />
      )}
    </div>
  );
}