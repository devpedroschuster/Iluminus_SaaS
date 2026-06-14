// gestao_web/src/components/ModalPreviewRepasses.jsx
//
// Modal de confirmação enriquecido para geração do lote mensal de repasses.
// Antes de confirmar, exibe preview calculado pela Edge Function
// `preview-repasses-mensais` (sem inserção) com:
//   - Total geral a ser gerado
//   - Breakdown por professor (regular vs plano livre)
//   - Avisos de alunos ignorados
//   - Estado "já gerado" com bloqueio visual
//
// Uso:
//   <ModalPreviewRepasses
//     isOpen={modal.isOpen}
//     onClose={modal.fechar}
//     mesAno="2025-06"             // formato YYYY-MM
//     onConfirm={handleGerar}      // chamado apenas após o usuário confirmar
//   />

import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle, CheckCircle2, RefreshCw, TrendingUp,
  Users, DollarSign, X, Loader2, Info, ChevronDown, ChevronUp,
  ShieldAlert,
} from 'lucide-react';

import Modal from './shared/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { formatarMoeda } from '../lib/utils';
import { previewRepassesMensais } from '../services/repasseService';

// ─── helpers ─────────────────────────────────────────────────────────────────

function mesAnoLabel(mesAno) {
  if (!mesAno) return '';
  const [ano, mes] = mesAno.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(mes) - 1]}/${ano}`;
}

// ─── sub-componentes ─────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-3 px-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-muted" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 rounded bg-muted" />
          <div className="h-2.5 w-20 rounded bg-muted/60" />
        </div>
      </div>
      <div className="h-4 w-16 rounded bg-muted" />
    </div>
  );
}

function ProfessorRow({ prof }) {
  const [expandido, setExpandido] = useState(false);
  const temBreakdown =
    prof.breakdown.regular > 0 && prof.breakdown.plano_livre > 0;

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-muted/30 transition-colors text-left group"
        onClick={() => temBreakdown && setExpandido(v => !v)}
        disabled={!temBreakdown}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-black text-primary">
              {prof.nome.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="font-bold text-sm text-foreground">{prof.nome}</p>
            <p className="text-xs text-muted-foreground">
              {prof.qtdLancamentos} lançamento{prof.qtdLancamentos !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-black text-foreground text-sm">
            {formatarMoeda(prof.total)}
          </span>
          {temBreakdown && (
            <span className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
              {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          )}
        </div>
      </button>

      {expandido && (
        <div className="px-4 pb-3 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
          {prof.breakdown.regular > 0 && (
            <div className="flex justify-between items-center text-xs px-3 py-1.5 rounded-lg bg-brand-soft">
              <span className="flex items-center gap-1.5 text-brand-foreground font-medium">
                <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                Regular
              </span>
              <span className="font-bold text-brand-foreground">
                {formatarMoeda(prof.breakdown.regular)}
              </span>
            </div>
          )}
          {prof.breakdown.plano_livre > 0 && (
            <div className="flex justify-between items-center text-xs px-3 py-1.5 rounded-lg bg-info-soft">
              <span className="flex items-center gap-1.5 text-info-foreground font-medium">
                <span className="w-2 h-2 rounded-full bg-info inline-block" />
                Plano Livre
              </span>
              <span className="font-bold text-info-foreground">
                {formatarMoeda(prof.breakdown.plano_livre)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AvisosSection({ avisos }) {
  const [aberto, setAberto] = useState(false);
  if (!avisos?.length) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning-soft overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-warning/10 transition-colors"
        onClick={() => setAberto(v => !v)}
      >
        <div className="flex items-center gap-2 text-warning-foreground">
          <AlertTriangle size={14} />
          <span className="text-xs font-bold">
            {avisos.length} aluno{avisos.length !== 1 ? 's' : ''} ignorado{avisos.length !== 1 ? 's' : ''}
          </span>
        </div>
        {aberto ? <ChevronUp size={14} className="text-warning-foreground" /> : <ChevronDown size={14} className="text-warning-foreground" />}
      </button>

      {aberto && (
        <ul className="px-4 pb-3 space-y-1.5 animate-in slide-in-from-top-1 duration-150 border-t border-warning/20">
          {avisos.map((av, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-warning-foreground/80 pt-1.5">
              <span className="shrink-0 mt-0.5">·</span>
              <span>{av}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── componente principal ────────────────────────────────────────────────────

export default function ModalPreviewRepasses({ isOpen, onClose, mesAno, onConfirm }) {
  const [estado, setEstado] = useState('idle'); // idle | carregando | pronto | erro | ja_gerado
  const [preview, setPreview] = useState(null);
  const [erroMsg, setErroMsg] = useState('');
  const [confirmando, setConfirmando] = useState(false);

  const carregarPreview = useCallback(async () => {
    if (!mesAno) return;
    setEstado('carregando');
    setPreview(null);
    setErroMsg('');

    try {
      const [ano, mes] = mesAno.split('-').map(Number);
      const data = await previewRepassesMensais(mes, ano);

      if (data?.jaGerados) {
        setEstado('ja_gerado');
        setPreview(data);
        return;
      }

      setPreview(data);
      setEstado(data?.lancamentosPrevistos === 0 ? 'vazio' : 'pronto');
    } catch (err) {
      setErroMsg(err?.message || 'Erro ao calcular preview dos repasses.');
      setEstado('erro');
    }
  }, [mesAno]);

  // Carrega sempre que o modal abre
  useEffect(() => {
    if (isOpen) carregarPreview();
    else {
      // Reset ao fechar
      setEstado('idle');
      setPreview(null);
      setConfirmando(false);
    }
  }, [isOpen, carregarPreview]);

  const handleConfirmar = async () => {
    setConfirmando(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setConfirmando(false);
    }
  };

  const label = mesAnoLabel(mesAno);

  // ── render ──────────────────────────────────────────────────────────────

  const footer = (
    <div className="flex justify-end gap-3">
      <Button variant="ghost" onClick={onClose} disabled={confirmando}>
        Cancelar
      </Button>

      {estado === 'pronto' && (
        <Button
          variant="brand"
          onClick={handleConfirmar}
          disabled={confirmando}
          className="flex items-center gap-2"
        >
          {confirmando
            ? <><Loader2 size={16} className="animate-spin" /> Gerando…</>
            : <><RefreshCw size={16} /> Confirmar e Gerar</>
          }
        </Button>
      )}

      {estado === 'erro' && (
        <Button variant="ghost" onClick={carregarPreview} className="flex items-center gap-2">
          <RefreshCw size={15} /> Tentar novamente
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titulo={`Gerar Repasses — ${label}`}
      tamanho="lg"
      footer={footer}
    >
      {/* ── CARREGANDO ── */}
      {estado === 'carregando' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground mb-4 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Calculando impacto para {label}…
          </p>
          {[1, 2, 3].map(i => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* ── ERRO ── */}
      {estado === 'erro' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle size={24} className="text-destructive" />
          </div>
          <div>
            <p className="font-bold text-foreground">Erro ao calcular preview</p>
            <p className="text-sm text-muted-foreground mt-1">{erroMsg}</p>
          </div>
        </div>
      )}

      {/* ── JÁ GERADO ── */}
      {estado === 'ja_gerado' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
            <ShieldAlert size={24} className="text-warning-foreground" />
          </div>
          <div>
            <p className="font-black text-foreground">Repasses já gerados</p>
            <p className="text-sm text-muted-foreground mt-1">
              O lote de <strong>{label}</strong> já foi processado anteriormente.
              Exclua os lançamentos existentes antes de regerar.
            </p>
          </div>
        </div>
      )}

      {/* ── VAZIO ── */}
      {estado === 'vazio' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Info size={24} className="text-muted-foreground" />
          </div>
          <div>
            <p className="font-bold text-foreground">Nenhum repasse previsto</p>
            <p className="text-sm text-muted-foreground mt-1">
              Não há alunos ativos com modalidades vinculadas a professores para {label}.
            </p>
          </div>
          {preview?.avisos?.length > 0 && (
            <div className="w-full mt-2">
              <AvisosSection avisos={preview.avisos} />
            </div>
          )}
        </div>
      )}

      {/* ── PRONTO ── */}
      {estado === 'pronto' && preview && (
        <div className="space-y-4">
          {/* KPI: total geral */}
          <div className="rounded-2xl bg-primary/5 border border-primary/15 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                Total a gerar em {label}
              </p>
              <p className="text-3xl font-black text-foreground mt-0.5">
                {formatarMoeda(preview.totalGeral)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {preview.lancamentosPrevistos} lançamento{preview.lancamentosPrevistos !== 1 ? 's' : ''} ·{' '}
                {preview.professores.length} professor{preview.professores.length !== 1 ? 'es' : ''}
              </p>
            </div>
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <DollarSign size={28} className="text-primary" />
            </div>
          </div>

          {/* Tabela por professor */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              Por professor
            </p>
            <div className="rounded-xl border border-border overflow-hidden bg-card divide-y divide-border">
              {preview.professores.map(prof => (
                <ProfessorRow key={prof.professor_id} prof={prof} />
              ))}
            </div>
            {preview.professores.some(p => p.breakdown.regular > 0 && p.breakdown.plano_livre > 0) && (
              <p className="text-[11px] text-muted-foreground/60 text-center mt-2">
                Toque no professor para ver o breakdown Regular / Plano Livre
              </p>
            )}
          </div>

          {/* Configurações usadas */}
          {preview.config && (
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral" variant="soft" className="text-[11px]">
                Regular 1 mod.: {formatarMoeda(preview.config.valor_1_modalidade)}
              </Badge>
              <Badge tone="neutral" variant="soft" className="text-[11px]">
                Regular multi: {formatarMoeda(preview.config.valor_multi_modalidade)}
              </Badge>
              <Badge tone="info" variant="soft" className="text-[11px]">
                Plano Livre: {preview.config.plano_livre_pct_prof}% prof.
              </Badge>
            </div>
          )}

          {/* Avisos */}
          <AvisosSection avisos={preview.avisos} />
        </div>
      )}
    </Modal>
  );
}