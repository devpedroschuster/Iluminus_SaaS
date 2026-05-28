import React, { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, UserPlus, Edit2, ShieldAlert, Trash2,
  Calendar, Eye, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { alunosService } from '../services/alunosService';
import { useDebounce } from '../hooks/useDebounce';
import { useAlunos, PAGE_SIZE } from '../hooks/useAlunos';
import Surface from '../components/ui/Surface';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { showToast } from '../components/shared/Toast';
import { ModalConfirmacao, useModal } from '../components/ui/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';

// ─── Constantes de layout ────────────────────────────────────────────────────

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ─── Mapas de normalização ───────────────────────────────────────────────────
// Nunca exibe valor bruto do banco. Toda leitura passa por estes mapas.

/** Mapeia o campo booleano `ativo` para rótulo e tom visual. */
const STATUS_ATIVO = {
  true:  { label: 'Ativo',   tone: 'success'     },
  false: { label: 'Inativo', tone: 'destructive'  },
};

/** Mapeia o campo `role` para rótulo legível. */
const ROLE_LABEL = {
  aluno:     'Aluno',
  admin:     'Admin',
  professor: 'Professor',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calcula o status de vencimento do plano a partir de data_fim_plano.
 *
 * @param {string|null} dataFim  formato 'YYYY-MM-DD'
 * @returns {{ tone: string, label: string, dias: number|null }}
 */
function calcularStatusVencimento(dataFim) {
  if (!dataFim) return { tone: 'neutral', label: 'Sem data', dias: null };

  const hoje = new Date();
  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const [ano, mes, dia] = dataFim.split('-').map(Number);
  const fimUTC = Date.UTC(ano, mes - 1, dia);
  const dias = Math.round((fimUTC - hojeUTC) / (1000 * 60 * 60 * 24));
  const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${String(ano).slice(-2)}`;

  if (dias < 0)  return { tone: 'destructive', label: dataFormatada, dias };
  if (dias <= 7) return { tone: 'warning',     label: dataFormatada, dias };
  return              { tone: 'success',      label: dataFormatada, dias };
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function Alunos() {
  const navigate = useNavigate();

  /**
   * PROBLEMA 2 — Filtros persistidos na URL.
   *
   * Todos os filtros e a página atual vivem em searchParams em vez de useState,
   * então o botão Voltar restaura exatamente o estado anterior e a URL pode
   * ser copiada/compartilhada com os filtros já aplicados.
   *
   * URL de exemplo: /alunos?role=aluno&letra=M&pagina=2
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const busca      = searchParams.get('busca')  ?? '';
  const filtroRole = searchParams.get('role')   ?? 'aluno';
  const letraAtiva = searchParams.get('letra')  ?? null;
  const pagina     = Math.max(1, parseInt(searchParams.get('pagina') ?? '1', 10));

  // Estado local apenas para modais (não faz sentido persistir na URL)
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const [confirmacaoNome,  setConfirmacaoNome]  = useState('');
  const modalStatus  = useModal();
  const modalExcluir = useModal();

  const buscaDebounced = useDebounce(busca, 400);

  /**
   * Atualiza searchParams de forma imutável.
   * Valores null ou string vazia removem o param da URL (mantém URL limpa).
   * `replace: true` evita poluir o histórico a cada keystroke.
   */
  const setParam = useCallback((updates) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([k, v]) => {
        if (v == null || v === '') next.delete(k);
        else next.set(k, String(v));
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Handlers de filtro — sempre resetam para página 1
  const handleBuscaChange  = (e) => setParam({ busca: e.target.value || null, letra: null,      pagina: null });
  const handleRoleChange   = (e) => setParam({ role: e.target.value,          pagina: null });
  const handleLetraClick   = (l) => {
    const nova = letraAtiva === l ? null : l;
    setParam({ letra: nova, busca: null, pagina: null });
  };

  /**
   * PROBLEMA 1 — Paginação real server-side.
   *
   * `pagina` vem da URL e é passada para o hook, que por sua vez
   * a repassa para alunosService.listar() → .range(offset, offset+24).
   * O Supabase retorna `count` exato com { count: 'exact' }, então
   * `total` e `totalPaginas` são sempre precisos.
   */
  const {
    alunos,
    loading,
    fetching,
    refetch,
    total,
    totalPaginas,
    temAnterior,
    temProximo,
  } = useAlunos(
    { role: filtroRole, busca: buscaDebounced, letraInicial: letraAtiva },
    pagina,
  );

  // Cálculo do intervalo exibido na barra de paginação
  const inicioRegistro = total === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const fimRegistro    = Math.min(pagina * PAGE_SIZE, total);

  // ── Ações de aluno ────────────────────────────────────────────────────────

  const alternarStatus = useCallback(async () => {
    if (!alunoSelecionado) return;
    try {
      const novoStatus = !alunoSelecionado.ativo;
      await alunosService.alterarStatus(alunoSelecionado.id, novoStatus);
      showToast.success(`Aluno ${novoStatus ? 'reativado' : 'desativado'} com sucesso!`);
      modalStatus.fechar();
      refetch();
    } catch {
      showToast.error('Erro ao alterar status.');
    }
  }, [alunoSelecionado, modalStatus, refetch]);

  const excluirAluno = useCallback(async () => {
    if (!alunoSelecionado) return;
    if (confirmacaoNome.trim() !== alunoSelecionado.nome_completo.trim()) {
      showToast.error('O nome digitado não confere. Exclusão cancelada.');
      return;
    }
    try {
      await alunosService.excluir(alunoSelecionado.id);
      showToast.success('Aluno excluído permanentemente!');
      modalExcluir.fechar();
      setConfirmacaoNome('');
      refetch();
    } catch (err) {
      if (err.message?.includes('violates foreign key constraint')) {
        showToast.error('Não é possível excluir: este aluno possui histórico. Utilize Desativar.');
      } else {
        showToast.error('Erro ao excluir aluno.');
      }
    }
  }, [alunoSelecionado, confirmacaoNome, modalExcluir, refetch]);

  // ── Render ────────────────────────────────────────────────────────────────

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
      <Surface variant="card" padding="md" className="flex flex-col gap-4 w-full">
        {/* Busca + role */}
        <div className="flex flex-col md:flex-row gap-4">
          <Input
            wrapperClassName="flex-1 w-full"
            leftIcon={<Search size={18} />}
            placeholder="Pesquisar por nome ou e-mail..."
            value={busca}
            onChange={handleBuscaChange}
          />
          <select
            className="w-full md:w-auto bg-muted px-6 py-3 rounded-2xl font-bold text-sm text-muted-foreground outline-none cursor-pointer hover:bg-subtle transition-colors"
            value={filtroRole}
            onChange={handleRoleChange}
          >
            <option value="aluno">Alunos</option>
            <option value="admin">Administradores</option>
            <option value="todos">Todos os perfis</option>
          </select>
        </div>

        {/* Filtro alfabético */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">
            Filtrar por inicial
          </span>
          <div className="flex flex-wrap gap-1">
            {LETRAS.map((letra) => (
              <button
                key={letra}
                onClick={() => handleLetraClick(letra)}
                className={`
                  w-8 h-8 rounded-xl text-xs font-black transition-colors
                  ${letraAtiva === letra
                    ? 'bg-brand text-white'
                    : 'bg-muted text-muted-foreground hover:bg-subtle hover:text-foreground'}
                `}
              >
                {letra}
              </button>
            ))}
          </div>
        </div>
      </Surface>

      {/* Tabela */}
      <Surface variant="card" padding="none" className="overflow-hidden">
        {loading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : alunos.length > 0 ? (
          <>
            {/*
              Anel de "buscando próxima página" — aparece só durante transições
              de página (keepPreviousData mantém os dados atuais visíveis,
              então não há flash de vazio).
            */}
            {fetching && !loading && (
              <div className="h-0.5 bg-brand/30 overflow-hidden">
                <div className="h-full bg-brand animate-pulse w-1/2 mx-auto rounded-full" />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-black uppercase text-muted-foreground tracking-widest border-b border-border bg-muted/40">
                    <th className="px-6 md:px-8 py-4 md:py-6 text-left">Aluno</th>
                    <th className="px-6 md:px-8 py-4 md:py-6 text-left">Plano / Cargo</th>
                    <th className="px-6 md:px-8 py-4 md:py-6 text-left">Status</th>
                    <th className="px-6 md:px-8 py-4 md:py-6 text-left">
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

                    /**
                     * PROBLEMA 3 — Normalização do status.
                     *
                     * Lê o booleano `ativo` via STATUS_ATIVO (mapa com chave string).
                     * Nunca exibe valor raw do banco. Valores inesperados caem no
                     * fallback neutro em vez de quebrar silenciosamente.
                     */
                    const statusInfo = STATUS_ATIVO[String(aluno.ativo)]
                      ?? { label: 'Indefinido', tone: 'neutral' };

                    return (
                      <tr
                        key={aluno.id}
                        className="group hover:bg-subtle transition-colors"
                      >
                        {/* Nome / email */}
                        <td className="px-6 md:px-8 py-4 md:py-6">
                          <div
                            className="flex items-center gap-3 md:gap-4 cursor-pointer"
                            onClick={() => navigate(`/alunos/${aluno.id}`)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && navigate(`/alunos/${aluno.id}`)}
                          >
                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-2xl bg-brand-soft text-brand font-black text-sm flex items-center justify-center shrink-0 uppercase">
                              {aluno.nome_completo?.[0] ?? '?'}
                            </div>
                            <div>
                              <p className="font-bold text-sm text-foreground leading-tight group-hover:text-primary transition-colors">
                                {aluno.nome_completo}
                              </p>
                              <p className="text-xs text-muted-foreground font-medium">
                                {aluno.email}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Plano / Cargo — role normalizado via mapa */}
                        <td className="px-6 md:px-8 py-4 md:py-6">
                          <span className="text-xs font-bold text-foreground block">
                            {aluno.planos?.nome || 'Sem Plano'}
                          </span>
                          <span className="text-[10px] font-black uppercase text-muted-foreground">
                            {ROLE_LABEL[aluno.role?.toLowerCase()] ?? aluno.role}
                          </span>
                        </td>

                        {/* Status ativo/inativo — via mapa, nunca raw */}
                        <td className="px-6 md:px-8 py-4 md:py-6">
                          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${
                            statusInfo.tone === 'success'
                              ? 'bg-success-soft text-success'
                              : statusInfo.tone === 'destructive'
                              ? 'bg-destructive-soft text-destructive'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              statusInfo.tone === 'success'     ? 'bg-success'
                              : statusInfo.tone === 'destructive' ? 'bg-destructive'
                              : 'bg-muted-foreground'
                            }`} />
                            <span className="text-[10px] font-black uppercase">
                              {statusInfo.label}
                            </span>
                          </div>
                        </td>

                        {/* Vencimento */}
                        <td className="px-6 md:px-8 py-4 md:py-6">
                          {aluno.role === 'admin' || !aluno.plano_id ? (
                            <Badge tone="neutral" variant="soft">—</Badge>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <Badge tone={vencimento.tone} variant="soft">
                                {vencimento.label}
                              </Badge>
                              {vencimento.dias !== null && (
                                <span className={`text-[10px] font-black ${
                                  vencimento.dias < 0  ? 'text-destructive'
                                  : vencimento.dias <= 7 ? 'text-warning'
                                  : 'text-muted-foreground'
                                }`}>
                                  {vencimento.dias < 0
                                    ? `${Math.abs(vencimento.dias)}d em atraso`
                                    : vencimento.dias === 0
                                    ? 'Vence hoje'
                                    : `${vencimento.dias}d restantes`}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Ações */}
                        <td className="px-6 md:px-8 py-4 md:py-6 text-right">
                          <div className="flex items-center justify-end gap-2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => navigate(`/alunos/${aluno.id}`)}
                              className="p-2 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary-soft transition-colors"
                              title="Ver Perfil"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              onClick={() => navigate('/alunos/novo', { state: { alunoParaEditar: aluno } })}
                              className="p-2 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary-soft transition-colors"
                              title="Editar"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => { setAlunoSelecionado(aluno); modalStatus.abrir(); }}
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
                              onClick={() => { setAlunoSelecionado(aluno); modalExcluir.abrir(); }}
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

            {/* ── Barra de paginação ───────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 md:px-8 py-4 border-t border-border bg-muted/20">
              {/* Contador "Mostrando X–Y de Z alunos" */}
              <p className="text-xs font-medium text-muted-foreground">
                {total > 0
                  ? <>Mostrando <strong className="text-foreground">{inicioRegistro}–{fimRegistro}</strong> de <strong className="text-foreground">{total}</strong> aluno{total !== 1 ? 's' : ''}</>
                  : 'Nenhum registro'}
              </p>

              {/* Controles de navegação */}
              {totalPaginas > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setParam({ pagina: pagina - 1 })}
                    disabled={!temAnterior}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors
                      disabled:opacity-40 disabled:cursor-not-allowed
                      bg-muted text-muted-foreground hover:bg-subtle hover:text-foreground"
                  >
                    <ChevronLeft size={14} />
                    Anterior
                  </button>

                  <span className="text-xs font-black text-muted-foreground px-2 tabular-nums">
                    {pagina} / {totalPaginas}
                  </span>

                  <button
                    onClick={() => setParam({ pagina: pagina + 1 })}
                    disabled={!temProximo}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors
                      disabled:opacity-40 disabled:cursor-not-allowed
                      bg-muted text-muted-foreground hover:bg-subtle hover:text-foreground"
                  >
                    Próxima
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          </>
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
        fechar={() => { modalExcluir.fechar(); setConfirmacaoNome(''); }}
        titulo="Excluir Aluno Permanentemente"
        mensagem={
          <div className="space-y-4">
            <p>
              Tem certeza que deseja excluir{' '}
              <strong>{alunoSelecionado?.nome_completo}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase text-muted-foreground tracking-widest">
                Digite o nome do aluno para confirmar
              </label>
              <input
                type="text"
                value={confirmacaoNome}
                onChange={(e) => setConfirmacaoNome(e.target.value)}
                placeholder={alunoSelecionado?.nome_completo}
                className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-destructive transition-colors"
                autoComplete="off"
              />
            </div>
          </div>
        }
        textoConfirmar="Excluir"
        tipo="danger"
        onConfirm={excluirAluno}
        confirmarDesabilitado={confirmacaoNome.trim() !== alunoSelecionado?.nome_completo?.trim()}
      />
    </div>
  );
}