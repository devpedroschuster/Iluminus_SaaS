import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User, CreditCard, Calendar, Activity,
  ArrowLeft, ExternalLink, FileText, CheckCircle, MapPin, Edit2, AlertTriangle,
  Link2, Save, TrendingUp, TrendingDown, Minus, MessageCircle, X, Phone,
  CalendarDays, BookOpen, RefreshCw, Plus, Trash2, Lock, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { alunosService } from '../services/alunosService';
import { TableSkeleton } from '../components/shared/Loading';
import { showToast } from '../components/shared/Toast';
import ModalRenovarPlano from '../components/ModalRenovarPlano';
import Surface from '../components/ui/Surface';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';

// ─────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
  'bg-amber-500',  'bg-rose-500', 'bg-cyan-500',
  'bg-pink-500',   'bg-indigo-500',
];
function hashNome(nome = '') {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function iniciais(nome = '') {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
const AVATAR_SIZE = {
  sm:  { box: 'w-10 h-10 rounded-2xl', text: 'text-sm'  },
  md:  { box: 'w-16 h-16 rounded-2xl', text: 'text-xl'  },
  lg:  { box: 'w-24 h-24 rounded-3xl', text: 'text-3xl' },
};
const AlunoAvatar = ({ nome = '', avatarUrl = null, size = 'lg' }) => {
  const { box, text } = AVATAR_SIZE[size] ?? AVATAR_SIZE.lg;
  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={nome} className={`${box} object-cover shrink-0`} />
    );
  }
  const cor = AVATAR_COLORS[hashNome(nome) % AVATAR_COLORS.length];
  return (
    <div className={`${box} ${cor} flex items-center justify-center shrink-0`}>
      <span className={`${text} font-black text-white select-none`}>{iniciais(nome)}</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const LabelDado = ({ titulo, valor }) => (
  <div className="space-y-1">
    <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest block">
      {titulo}
    </label>
    <p className="font-bold text-foreground">
      {valor ?? <span className="text-muted-foreground italic font-medium">Não informado</span>}
    </p>
  </div>
);
const Th = ({ children, className = '' }) => (
  <th className={`p-5 text-[10px] font-black uppercase text-muted-foreground tracking-widest ${className}`}>
    {children}
  </th>
);
function gerarLinkWhatsApp(telefone, mensagem) {
  const num = (telefone || '').replace(/\D/g, '');
  if (!num) return null;
  const numCompleto = num.startsWith('55') ? num : `55${num}`;
  return `https://wa.me/${numCompleto}?text=${encodeURIComponent(mensagem)}`;
}
function BotaoWhatsApp({ aluno }) {
  const telefone = aluno?.telefone;
  const nome = aluno?.nome_completo?.split(' ')[0] || 'aluno(a)';
  const mensagem = `Olá ${nome}, tudo bem? Passando aqui pelo Iluminus para falar com você! 😊`;
  const link = gerarLinkWhatsApp(telefone, mensagem);
  if (!link) {
    return (
      <Button variant="ghost" size="md" leftIcon={<MessageCircle size={16} />}
        disabled title="Telefone não cadastrado" className="opacity-40 cursor-not-allowed">
        WhatsApp
      </Button>
    );
  }
  return (
    <Button as="a" href={link} target="_blank" rel="noreferrer" variant="outline" size="md"
      leftIcon={<MessageCircle size={16} className="text-emerald-500" />}
      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950">
      WhatsApp
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────
// Modal Editar Cadastro
// ─────────────────────────────────────────────────────────────
function ModalEditarCadastro({ aluno, alunoId, queryClient, onClose }) {
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    nome_completo:      aluno?.nome_completo      ?? '',
    email:              aluno?.email              ?? '',
    telefone:           aluno?.telefone           ?? '',
    cpf:                aluno?.cpf                ?? '',
    data_nascimento:    aluno?.data_nascimento    ?? '',
    contato_emergencia: aluno?.contato_emergencia ?? '',
    cep:          aluno?.cep          ?? '',
    rua:          aluno?.rua          ?? '',
    numero:       aluno?.numero       ?? '',
    complemento:  aluno?.complemento  ?? '',
    bairro:       aluno?.bairro       ?? '',
    cidade:       aluno?.cidade       ?? '',
  });
  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }));
  const handleSalvar = async () => {
    if (!form.nome_completo.trim()) {
      showToast.error('Nome completo é obrigatório.');
      return;
    }
    setSalvando(true);
    try {
      await alunosService.atualizar(alunoId, {
        nome_completo:      form.nome_completo.trim(),
        email:              form.email.trim()              || null,
        telefone:           form.telefone.trim()           || null,
        cpf:                form.cpf.trim()                || null,
        data_nascimento:    form.data_nascimento           || null,
        contato_emergencia: form.contato_emergencia.trim() || null,
        cep:                form.cep.trim()                || null,
        rua:                form.rua.trim()                || null,
        numero:             form.numero.trim()             || null,
        complemento:        form.complemento.trim()        || null,
        bairro:             form.bairro.trim()             || null,
        cidade:             form.cidade.trim()             || null,
      });
      queryClient.invalidateQueries(['aluno', alunoId]);
      showToast.success('Cadastro atualizado com sucesso!');
      onClose();
    } catch (err) {
      console.error('[PerfilAluno] Erro ao salvar cadastro:', err);
      showToast.error('Erro ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };
  const buscarCep = async (cep) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm(f => ({
          ...f,
          rua:    data.logradouro || f.rua,
          bairro: data.bairro     || f.bairro,
          cidade: data.localidade || f.cidade,
        }));
      }
    } catch {}
  };
  const labelClass = 'text-[10px] uppercase font-black text-muted-foreground tracking-widest block mb-1.5';
  const inputClass = 'w-full border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-8 py-6 border-b border-border shrink-0">
          <div>
            <h2 className="text-xl font-black text-foreground">Editar Cadastro</h2>
            <p className="text-muted-foreground text-sm font-medium mt-0.5">{aluno?.nome_completo}</p>
          </div>
          <button onClick={onClose}
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-8 py-6 space-y-8">
          <div className="space-y-5">
            <h3 className="font-black text-foreground flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
              <User size={16} /> Dados Pessoais
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className={labelClass}>Nome Completo *</label>
                <input className={inputClass} value={form.nome_completo} onChange={set('nome_completo')} placeholder="Nome completo do aluno" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Data de Nascimento</label>
                <input type="date" className={inputClass} value={form.data_nascimento} onChange={set('data_nascimento')} />
              </div>
              <div>
                <label className={labelClass}>CPF</label>
                <input className={inputClass} value={form.cpf} onChange={set('cpf')} placeholder="000.000.000-00" />
              </div>
            </div>
            <div>
              <label className={labelClass}>Contato de Emergência</label>
              <input className={inputClass} value={form.contato_emergencia} onChange={set('contato_emergencia')} placeholder="Nome — (51) 9 0000-0000" />
            </div>
          </div>
          <div className="space-y-5">
            <h3 className="font-black text-foreground flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
              <Phone size={16} /> Contato
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>E-mail</label>
                <input type="email" className={inputClass} value={form.email} onChange={set('email')} placeholder="email@exemplo.com" />
              </div>
              <div>
                <label className={labelClass}>Telefone / WhatsApp</label>
                <input className={inputClass} value={form.telefone} onChange={set('telefone')} placeholder="(51) 9 0000-0000" />
              </div>
            </div>
          </div>
          <div className="space-y-5">
            <h3 className="font-black text-foreground flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
              <MapPin size={16} /> Endereço
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>CEP</label>
                <input className={inputClass} value={form.cep} onChange={set('cep')}
                  onBlur={(e) => buscarCep(e.target.value)} placeholder="00000-000" maxLength={9} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Logradouro</label>
                <input className={inputClass} value={form.rua} onChange={set('rua')} placeholder="Rua, Avenida..." />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Número</label>
                <input className={inputClass} value={form.numero} onChange={set('numero')} placeholder="123" />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Complemento</label>
                <input className={inputClass} value={form.complemento} onChange={set('complemento')} placeholder="Apto, Bloco..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Bairro</label>
                <input className={inputClass} value={form.bairro} onChange={set('bairro')} placeholder="Bairro" />
              </div>
              <div>
                <label className={labelClass}>Cidade</label>
                <input className={inputClass} value={form.cidade} onChange={set('cidade')} placeholder="Cidade" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-8 py-5 border-t border-border shrink-0">
          <Button variant="ghost" size="md" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="brand" size="md" leftIcon={<Save size={16} />} onClick={handleSalvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Card Uso do Plano
// ─────────────────────────────────────────────────────────────
function CardUsoPlan({ aluno, planos, frequencia }) {
  if (!aluno?.plano_id) {
    return (
      <div className="bg-muted p-8 rounded-3xl relative overflow-hidden flex flex-col justify-center min-h-[140px] border border-border">
        <div className="relative z-10">
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-2">Uso do Plano</p>
          <h3 className="text-2xl font-black text-muted-foreground">Sem plano</h3>
          <p className="text-muted-foreground/60 text-xs font-medium mt-2">Nenhum plano ativo vinculado</p>
        </div>
      </div>
    );
  }
  const planoAtivo = planos?.find(p => p.status === 'ativo') ?? null;
  if (!planoAtivo) {
    return (
      <div className="bg-warning/10 border border-warning/30 p-8 rounded-3xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
        <div className="relative z-10">
          <p className="text-warning text-xs font-bold uppercase tracking-wider mb-2">Uso do Plano</p>
          <h3 className="text-xl font-black text-warning leading-tight">Histórico pendente</h3>
          <p className="text-warning/70 text-xs font-medium mt-2">
            Acesse "Histórico" e clique em Renovar para registrar o ciclo atual
          </p>
        </div>
      </div>
    );
  }
  const inicio = new Date(planoAtivo.data_inicio + 'T00:00:00');
  const fim    = new Date(planoAtivo.data_fim    + 'T23:59:59');
  const diffDays     = Math.ceil(Math.abs(fim - inicio) / (1000 * 60 * 60 * 24));
  const totalSemanas = Math.ceil(diffDays / 7) || 1;
  let limiteSemanal = 0;
  let isLivre       = false;
  const regras = planoAtivo.planos?.regras_acesso;
  if (Array.isArray(regras)) {
    regras.forEach(r => {
      const l = parseInt(r.limite);
      if (l >= 99) isLivre = true;
      else limiteSemanal += l;
    });
  }
  const aulasUsadas = (frequencia ?? []).filter(f => {
    const d = new Date(f.data_checkin);
    return d >= inicio && d <= fim;
  }).length;
  let textoFrequencia, subtituloFrequencia, percentualUso;
  if (isLivre) {
    textoFrequencia     = `${aulasUsadas} aulas`;
    subtituloFrequencia = 'Acesso Livre / Ilimitado';
    percentualUso       = 100;
  } else {
    const totalAulas = limiteSemanal * totalSemanas;
    textoFrequencia     = `${aulasUsadas} de ${totalAulas}`;
    subtituloFrequencia = `Ciclo de ${totalSemanas} sem. • ${limiteSemanal}×/sem`;
    percentualUso       = totalAulas > 0 ? Math.min((aulasUsadas / totalAulas) * 100, 100) : 0;
  }
  const [num, ...rest] = textoFrequencia.split(' ');
  return (
    <div className="bg-primary p-8 rounded-3xl text-primary-foreground relative overflow-hidden flex flex-col justify-center min-h-[140px]">
      <div className="relative z-10">
        <p className="text-primary-foreground/70 text-xs font-bold uppercase tracking-wider">Uso do Plano</p>
        <h3 className="text-4xl font-black mt-1 flex items-baseline gap-2">
          {num}
          <span className="text-lg font-medium text-primary-foreground/60">{rest.join(' ')}</span>
        </h3>
        <p className="text-primary-foreground/60 text-xs font-medium mt-2">{subtituloFrequencia}</p>
      </div>
      <div className="absolute bottom-0 left-0 w-full h-2 bg-black/10">
        <div className="h-full bg-white/40 transition-all duration-1000 ease-out" style={{ width: `${percentualUso}%` }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Heatmap Frequência
// ─────────────────────────────────────────────────────────────
function HeatmapFrequencia({ frequencia, planoAtivo }) {
  const hoje      = new Date();
  const SEMANAS   = 12;
  const totalDias = SEMANAS * 7;
  const ancor = new Date(hoje);
  ancor.setDate(hoje.getDate() - totalDias + 1);
  ancor.setDate(ancor.getDate() - ancor.getDay());
  const datasComPresenca = new Set(
    (frequencia ?? []).map(f => new Date(f.data_checkin).toISOString().split('T')[0])
  );
  const cells = Array.from({ length: SEMANAS * 7 }, (_, i) => {
    const d   = new Date(ancor);
    d.setDate(ancor.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    return {
      iso,
      hasPresence: datasComPresenca.has(iso),
      isToday:     iso === hoje.toISOString().split('T')[0],
      isFuture:    d > hoje,
    };
  });
  const mesesLabel = Array.from({ length: SEMANAS }, (_, s) => {
    const d = new Date(ancor);
    d.setDate(ancor.getDate() + s * 7);
    return s === 0 || d.getDate() <= 7
      ? d.toLocaleString('pt-BR', { month: 'short' })
      : '';
  });
  let badgeTone  = 'neutral';
  let badgeLabel = 'Sem dados de plano';
  let BadgeIcon  = Minus;
  if (planoAtivo?.data_inicio && planoAtivo?.data_fim) {
    const pInicio = new Date(planoAtivo.data_inicio + 'T00:00:00');
    const pFim    = new Date(planoAtivo.data_fim    + 'T23:59:59');
    const regras  = planoAtivo.planos?.regras_acesso;
    let limiteSemanal = 0;
    let isLivre       = false;
    if (Array.isArray(regras)) {
      regras.forEach(r => {
        const l = parseInt(r.limite);
        if (l >= 99) isLivre = true;
        else limiteSemanal += l;
      });
    }
    if (isLivre) {
      badgeTone  = 'success';
      badgeLabel = 'Acesso Livre';
      BadgeIcon  = TrendingUp;
    } else if (limiteSemanal > 0) {
      const quatroSemanas = new Date(hoje);
      quatroSemanas.setDate(hoje.getDate() - 28);
      const aulasRecentes = (frequencia ?? []).filter(f => {
        const d = new Date(f.data_checkin);
        return d >= quatroSemanas && d <= hoje && d >= pInicio && d <= pFim;
      }).length;
      const meta = limiteSemanal * 4;
      const taxa = meta > 0 ? aulasRecentes / meta : 0;
      if (taxa >= 0.85)      { badgeTone = 'success'; badgeLabel = 'Em dia';          BadgeIcon = TrendingUp;   }
      else if (taxa >= 0.5)  { badgeTone = 'warning'; badgeLabel = 'Atenção';         BadgeIcon = Minus;        }
      else                   { badgeTone = 'danger';  badgeLabel = 'Abaixo da meta';  BadgeIcon = TrendingDown; }
    }
  }
  const toneClass = {
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    danger:  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    neutral: 'bg-muted text-muted-foreground',
  };
  const diasLabel = ['D','S','T','Q','Q','S','S'];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">
          Últimas {SEMANAS} semanas
        </p>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${toneClass[badgeTone]}`}>
          <BadgeIcon size={12} />
          {badgeLabel}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div
          style={{ display: 'grid', gridTemplateColumns: `20px repeat(${SEMANAS}, 1fr)`, gap: '3px', minWidth: 340 }}
        >
          <div className="flex flex-col gap-[3px]">
            <div style={{ height: 14 }} />
            {diasLabel.map((d, i) => (
              <div key={i} style={{ height: 14 }}
                className="text-[9px] font-bold text-muted-foreground flex items-center justify-end pr-1">
                {i % 2 === 1 ? d : ''}
              </div>
            ))}
          </div>
          {Array.from({ length: SEMANAS }, (_, s) => (
            <div key={s} className="flex flex-col gap-[3px]">
              <div style={{ height: 14 }} className="text-[9px] font-bold text-muted-foreground truncate">
                {mesesLabel[s]}
              </div>
              {Array.from({ length: 7 }, (_, dow) => {
                const cell = cells[s * 7 + dow];
                if (!cell) return <div key={dow} style={{ height: 14, borderRadius: 3 }} />;
                return (
                  <div key={dow} title={cell.iso} style={{ height: 14, borderRadius: 3 }}
                    className={`transition-colors ${
                      cell.isFuture
                        ? 'bg-muted/30'
                        : cell.hasPresence
                          ? 'bg-primary opacity-90'
                          : 'bg-muted'
                    } ${cell.isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-medium">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-muted" /> Sem aula
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-primary opacity-90" /> Presente
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Aba Anamnese
// ─────────────────────────────────────────────────────────────
function AbaAnamnese({ aluno, alunoId, queryClient, observacoesMedicas, setObservacoesMedicas, salvandoMedico, setSalvandoMedico }) {
  const [editandoLink, setEditandoLink] = useState(false);
  const [novoLink, setNovoLink]         = useState(aluno?.link_anamnese ?? '');
  const [salvandoLink, setSalvandoLink] = useState(false);
  React.useEffect(() => {
    setNovoLink(aluno?.link_anamnese ?? '');
  }, [aluno?.link_anamnese]);
  const handleSalvarLink = async () => {
    if (salvandoLink) return;
    setSalvandoLink(true);
    try {
      await alunosService.atualizar(alunoId, { link_anamnese: novoLink.trim() || null });
      queryClient.invalidateQueries(['aluno', alunoId]);
      showToast.success('Link da anamnese atualizado!');
      setEditandoLink(false);
    } catch (err) {
      console.error('[PerfilAluno] Erro ao salvar link_anamnese:', err);
      showToast.error('Erro ao salvar o link. Tente novamente.');
    } finally {
      setSalvandoLink(false);
    }
  };
  const handleSalvarObservacoesMedicas = async () => {
    if (salvandoMedico) return;
    setSalvandoMedico(true);
    try {
      await alunosService.atualizar(alunoId, { observacoes_medicas: observacoesMedicas });
      showToast.success('Resumo médico salvo com sucesso!');
    } catch (err) {
      console.error('[PerfilAluno] Erro ao salvar observações médicas:', err);
      showToast.error('Erro ao salvar. Tente novamente.');
    } finally {
      setSalvandoMedico(false);
    }
  };
  const linkValido = novoLink.trim() && /^https?:\/\/.+/.test(novoLink.trim());
  return (
    <div className="max-w-2xl space-y-6 animate-in slide-in-from-bottom-4">
      <Surface variant="card" padding="lg" className="bg-primary-soft border-primary/20 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-black text-primary mb-1">Ficha Médica Externa (Forms)</h3>
            <p className="text-primary/70 text-sm leading-relaxed">
              Link para o formulário de anamnese preenchido pelo aluno.
            </p>
          </div>
          <button onClick={() => setEditandoLink(v => !v)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-primary border border-primary/30 hover:bg-primary/10 transition-colors">
            <Link2 size={13} />
            {editandoLink ? 'Cancelar' : (aluno?.link_anamnese ? 'Editar link' : 'Vincular link')}
          </button>
        </div>
        {editandoLink && (
          <div className="space-y-3 animate-in slide-in-from-top-2">
            <input type="url" placeholder="https://forms.google.com/..."
              value={novoLink} onChange={e => setNovoLink(e.target.value)}
              className="w-full border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground" />
            {novoLink && !linkValido && (
              <p className="text-xs font-medium text-destructive flex items-center gap-1">
                <AlertTriangle size={12} /> URL inválida — deve começar com https://
              </p>
            )}
            {linkValido && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-xl text-xs font-medium text-muted-foreground border border-border">
                <ExternalLink size={12} className="shrink-0 text-primary" />
                <span className="truncate">{novoLink.trim()}</span>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="brand" size="sm" leftIcon={<Save size={14} />}
                onClick={handleSalvarLink} disabled={salvandoLink || (!!novoLink && !linkValido)}>
                {salvandoLink ? 'Salvando...' : 'Salvar link'}
              </Button>
              {aluno?.link_anamnese && (
                <button onClick={() => setNovoLink('')}
                  className="text-xs font-bold text-destructive hover:underline">
                  Remover link
                </button>
              )}
            </div>
          </div>
        )}
        {!editandoLink && (
          aluno?.link_anamnese ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 p-3 bg-muted/60 rounded-xl text-xs font-medium text-muted-foreground border border-border">
                <Link2 size={12} className="shrink-0 text-primary" />
                <span className="truncate flex-1">{aluno.link_anamnese}</span>
                <a href={aluno.link_anamnese} target="_blank" rel="noreferrer"
                  className="shrink-0 text-primary hover:underline flex items-center gap-1">
                  <ExternalLink size={12} /> Abrir
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium text-muted-foreground italic">
              Nenhum formulário vinculado ainda.
            </p>
          )
        )}
      </Surface>
      <Surface variant="card" padding="xl" className="space-y-4">
        <h3 className="font-black text-foreground flex items-center gap-2">
          <Activity size={20} className="text-destructive" />
          Observações Médicas Rápidas
        </h3>
        <Input as="textarea" rows={6}
          placeholder="Lesões, restrições, alergias, medicamentos em uso..."
          value={observacoesMedicas}
          onChange={(e) => setObservacoesMedicas(e.target.value)} />
        <Button variant="brand" size="sm" leftIcon={<Save size={14} />}
          onClick={handleSalvarObservacoesMedicas} disabled={salvandoMedico}>
          {salvandoMedico ? 'Salvando...' : 'Salvar Observações'}
        </Button>
      </Surface>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Aba Modalidades
// ─────────────────────────────────────────────────────────────
function AbaModalidades({ aluno, alunoId, queryClient }) {
  const [modalidades, setModalidades] = useState([]);
  const [modalidadesSelecionadas, setModalidadesSelecionadas] = useState(
    aluno?.modalidades_selecionadas || []
  );
  const [salvando, setSalvando] = useState(false);
  const regrasPlano = aluno?.planos?.regras_acesso || [];

  React.useEffect(() => {
    supabase.from('modalidades').select('id, nome, area').order('area').order('nome')
      .then(({ data }) => setModalidades(data || []));
  }, []);

  React.useEffect(() => {
    setModalidadesSelecionadas(aluno?.modalidades_selecionadas || []);
  }, [aluno?.modalidades_selecionadas]);

  // Helpers de contagem
  const getCountModEspecifica = (modId) =>
    modalidadesSelecionadas.filter(id => id === modId).length;
  const getUsoPorArea = (areaNome) =>
    modalidadesSelecionadas.filter(id =>
      modalidades.find(m => m.id === id)?.area === areaNome
    ).length;
  const getRegraDaArea   = (areaNome) => regrasPlano.find(r => r.modalidade === areaNome);
  const podeAdicionarMod = (modArea) => {
    const regra = getRegraDaArea(modArea);
    if (!regra) return false;
    if (regra.limite === 999) return true;
    return getUsoPorArea(modArea) < regra.limite;
  };
  const addModalidade    = (modId) => setModalidadesSelecionadas(prev => [...prev, modId]);
  const removeModalidade = (modId) => {
    setModalidadesSelecionadas(prev => {
      const index = prev.lastIndexOf(modId);
      if (index > -1) {
        const nova = [...prev];
        nova.splice(index, 1);
        return nova;
      }
      return prev;
    });
  };

  const modalidadesAgrupadas = modalidades.reduce((acc, mod) => {
    const area = mod.area || 'Outros';
    if (!acc[area]) acc[area] = [];
    acc[area].push(mod);
    return acc;
  }, {});

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      await alunosService.atualizar(alunoId, {
        modalidades_selecionadas: modalidadesSelecionadas,
      });
      queryClient.invalidateQueries(['aluno', alunoId]);
      showToast.success('Modalidades atualizadas com sucesso!');
    } catch (err) {
      console.error('[PerfilAluno] Erro ao salvar modalidades:', err);
      showToast.error('Erro ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const semPlano = !aluno?.plano_id;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 max-w-3xl">
      {semPlano && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning-soft border border-warning/30 text-warning-foreground">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-sm">Nenhum plano vinculado</p>
            <p className="text-xs font-medium mt-0.5 text-muted-foreground">
              Vincule um plano ao aluno para que as regras de modalidade sejam aplicadas.
              As modalidades salvas aqui são usadas para controle de turma e repasses.
            </p>
          </div>
        </div>
      )}

      {!semPlano && regrasPlano.length > 0 && (
        <Surface variant="card" padding="md" className="bg-info-soft border-info/20">
          <div className="flex items-center gap-2 mb-3">
            <Info size={18} className="text-info" />
            <h4 className="font-black text-info-foreground text-sm">
              Regras do Plano: {aluno?.planos?.nome}
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {regrasPlano.map((r, i) => {
              const usoAtual   = getUsoPorArea(r.modalidade);
              const limiteText = r.limite === 999 ? 'Ilimitado' : `${r.limite}x`;
              const isFull     = r.limite !== 999 && usoAtual >= r.limite;
              return (
                <span key={i} className={`border px-3 py-1.5 rounded-xl font-bold text-xs transition-colors
                  ${isFull
                    ? 'bg-info text-info-foreground border-info'
                    : 'bg-background text-info border-info/30'}`}>
                  {limiteText} em {r.modalidade}
                  {isFull && <CheckCircle size={12} className="inline ml-1" />}
                </span>
              );
            })}
          </div>
        </Surface>
      )}

      <div className="space-y-4">
        {Object.entries(modalidadesAgrupadas).map(([areaNome, modsArea]) => {
          const regra           = getRegraDaArea(areaNome);
          const isAreaBloqueada = !regra && !semPlano;
          return (
            <Surface
              key={areaNome}
              variant="card"
              padding="md"
              className={isAreaBloqueada ? 'opacity-50' : ''}
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-black text-foreground text-sm uppercase tracking-widest flex items-center gap-2">
                  <BookOpen size={14} className="text-primary" />
                  {areaNome}
                  {isAreaBloqueada && <Lock size={13} className="text-muted-foreground" />}
                </h4>
                {!isAreaBloqueada && regra && regra.limite !== 999 && (
                  <span className="text-xs font-bold text-info bg-info-soft px-2 py-1 rounded-lg">
                    {getUsoPorArea(areaNome)} / {regra.limite} usados
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {modsArea.map(mod => {
                  const count    = getCountModEspecifica(mod.id);
                  const isAtivo  = count > 0;
                  const allowAdd = podeAdicionarMod(areaNome) || semPlano;
                  return (
                    <div key={mod.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all
                      ${isAreaBloqueada
                        ? 'bg-muted border-border'
                        : isAtivo
                          ? 'bg-primary-soft border-primary/20'
                          : 'bg-background border-border hover:border-primary/30'}`}>
                      <span className={`text-sm font-bold ${isAtivo ? 'text-primary' : 'text-muted-foreground'}`}>
                        {mod.nome}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => removeModalidade(mod.id)}
                          disabled={!isAtivo}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-background shadow-sm text-muted-foreground font-black hover:bg-destructive-soft hover:text-destructive disabled:opacity-30 disabled:shadow-none transition-colors"
                        >
                          −
                        </button>
                        <span className={`font-black w-5 text-center text-sm ${isAtivo ? 'text-primary' : 'text-muted-foreground/40'}`}>
                          {count}x
                        </span>
                        <button
                          type="button"
                          onClick={() => addModalidade(mod.id)}
                          disabled={(!allowAdd && !semPlano) || isAreaBloqueada}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-background shadow-sm font-black transition-colors text-info hover:bg-info-soft disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Surface>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="brand" size="lg" leftIcon={<Save size={16} />}
          onClick={handleSalvar} disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar Modalidades'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Aba Agenda Fixa
// ─────────────────────────────────────────────────────────────
function AbaAgendaFixa({ aluno, alunoId }) {
  const [aulasGrade, setAulasGrade]         = useState([]);
  const [matriculasAluno, setMatriculasAluno] = useState([]);
  const [loading, setLoading]               = useState(true);
  // BP-01 – substituição de window.confirm
  const [confirmModal, setConfirmModal]     = useState(null);
  // confirmModal: { mensagem, onConfirmar } | null
  const modalidades = aluno?.modalidades_selecionadas
    ? [...new Set(aluno.modalidades_selecionadas)]
    : [];

  React.useEffect(() => {
    carregarAgendaFixa();
  }, [alunoId]);

  async function carregarAgendaFixa() {
    setLoading(true);
    try {
      const diasOrdem = {
        'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
        'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6,
      };
      const { data: aulas } = await supabase
        .from('agenda')
        .select('*, modalidades(id, nome)')
        .eq('eh_recorrente', true);
      setAulasGrade(
        (aulas || []).sort((a, b) => {
          if (diasOrdem[a.dia_semana] !== diasOrdem[b.dia_semana])
            return diasOrdem[a.dia_semana] - diasOrdem[b.dia_semana];
          return a.horario.localeCompare(b.horario);
        })
      );
      const { data: matriculas } = await supabase
        .from('agenda_fixa')
        .select('aula_id')
        .eq('aluno_id', alunoId);
      setMatriculasAluno(matriculas?.map(m => m.aula_id) || []);
    } catch {
      showToast.error('Erro ao carregar grade fixa.');
    } finally {
      setLoading(false);
    }
  }

  // Conta quantas vezes uma modalidade (id) aparece em modalidadesSelecionadas do aluno
  const getCountModEspecifica = (modId) =>
    (aluno?.modalidades_selecionadas || []).filter(id => id === modId).length;

  const countUsoModNaGrade = (modId) =>
    matriculasAluno.filter(aulaId =>
      aulasGrade.find(a => a.id === aulaId)?.modalidades?.id === modId
    ).length;

  async function executarMatricula(aula) {
    try {
      const { error } = await supabase.from('agenda_fixa')
        .insert({ aluno_id: alunoId, aula_id: aula.id });
      if (error) throw error;
      showToast.success('Aluno matriculado na turma!');
      carregarAgendaFixa();
    } catch { showToast.error('Erro ao matricular na turma.'); }
  }

  async function executarRemocao(aula) {
    try {
      const { error } = await supabase.from('agenda_fixa')
        .delete().match({ aluno_id: alunoId, aula_id: aula.id });
      if (error) throw error;
      showToast.success('Aluno removido da turma.');
      carregarAgendaFixa();
    } catch { showToast.error('Erro ao remover da turma.'); }
  }

  function toggleMatriculaFixa(aula) {
    const isMatriculado = matriculasAluno.includes(aula.id);
    if (!isMatriculado) {
      const limiteSelecionado = getCountModEspecifica(aula.modalidades?.id);
      const usado             = countUsoModNaGrade(aula.modalidades?.id);
      if (limiteSelecionado > 0 && usado >= limiteSelecionado) {
        setConfirmModal({
          mensagem: `ATENÇÃO: Apenas ${limiteSelecionado}x de "${aula.modalidades?.nome}" definido no perfil.\n\nDeseja abrir uma exceção e matricular na ${usado + 1}ª turma?`,
          onConfirmar: () => executarMatricula(aula),
        });
        return;
      }
      executarMatricula(aula);
    } else {
      setConfirmModal({
        mensagem: `Deseja remover o aluno da turma de ${aula.dia_semana} às ${aula.horario}?`,
        onConfirmar: () => executarRemocao(aula),
      });
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center p-16">
        <RefreshCw className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  // Agrupa as aulas disponíveis por modalidade (somente as que o aluno tem em modalidades_selecionadas)
  // Se o aluno não tiver modalidades definidas, exibe todas as aulas
  const modIdsDoAluno = [...new Set(aluno?.modalidades_selecionadas || [])];
  const aulasDoAluno = modIdsDoAluno.length > 0
    ? aulasGrade.filter(a => modIdsDoAluno.includes(a.modalidades?.id))
    : aulasGrade;

  // Agrupa por modalidade
  const aulasAgrupadasPorMod = aulasDoAluno.reduce((acc, aula) => {
    const modId   = aula.modalidades?.id   || 'sem-mod';
    const modNome = aula.modalidades?.nome || 'Sem Modalidade';
    if (!acc[modId]) acc[modId] = { nome: modNome, aulas: [] };
    acc[modId].aulas.push(aula);
    return acc;
  }, {});

  const semModalidades = modIdsDoAluno.length === 0;

  return (
    <>
    <div className="space-y-6 animate-in slide-in-from-bottom-4">
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary-soft border border-primary/20">
        <CalendarDays size={18} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="font-bold text-sm text-foreground">Turmas Fixas</p>
          <p className="text-xs font-medium mt-0.5 text-muted-foreground">
            Matricule o aluno nas turmas regulares.
            {semModalidades
              ? ' As modalidades do aluno ainda não foram definidas — todas as turmas estão visíveis.'
              : ' Exibindo apenas as turmas das modalidades selecionadas no perfil.'}
          </p>
        </div>
      </div>

      {Object.keys(aulasAgrupadasPorMod).length === 0 ? (
        <Surface variant="card" padding="xl" className="text-center">
          <CalendarDays size={32} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">
            Nenhuma turma disponível para as modalidades selecionadas.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Verifique a aba <strong>Modalidades</strong> e a grade de aulas.
          </p>
        </Surface>
      ) : (
        Object.entries(aulasAgrupadasPorMod).map(([modId, { nome: modNome, aulas: turmas }]) => {
          const limite = getCountModEspecifica(modId === 'sem-mod' ? null : modId);
          const usado  = countUsoModNaGrade(modId === 'sem-mod' ? null : modId);
          const isFull = limite > 0 && usado >= limite;
          return (
            <div key={modId} className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm">
              <div className="bg-muted/50 border-b border-border p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                <h3 className="font-black text-foreground text-lg">{modNome}</h3>
                {limite > 0 && (
                  <span className={`px-3 py-1 rounded-lg font-black text-xs uppercase tracking-wider
                    ${isFull ? 'bg-warning-soft text-warning-foreground' : 'bg-success-soft text-success'}`}>
                    Vagas: {usado} de {limite}
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {turmas.map(aula => {
                    const isMatriculado = matriculasAluno.includes(aula.id);
                    return (
                      <div key={aula.id} className={`p-4 rounded-2xl border-2 flex justify-between items-center transition-all
                        ${isMatriculado
                          ? 'border-success/30 bg-success-soft/30'
                          : 'border-border bg-background hover:border-primary/30'}`}>
                        <div>
                          <p className="font-black text-foreground">{aula.dia_semana}</p>
                          <p className="text-sm font-medium text-muted-foreground">
                            {aula.horario.slice(0, 5)} — {aula.atividade}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleMatriculaFixa(aula)}
                          className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors
                            ${isMatriculado
                              ? 'bg-destructive-soft text-destructive hover:bg-destructive hover:text-destructive-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-success hover:text-success-foreground'}`}
                          title={isMatriculado ? 'Remover da turma' : 'Matricular na turma'}
                        >
                          {isMatriculado ? <Trash2 size={18} /> : <Plus size={18} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>

    {/* BP-01 – Modal de confirmação (substitui window.confirm) */}
    {confirmModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
      >
        <div className="bg-background rounded-3xl shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200">
          <h3 className="font-black text-foreground text-lg mb-4">Confirmação</h3>
          <p className="text-muted-foreground font-medium mb-8 whitespace-pre-line leading-relaxed">
            {confirmModal.mensagem}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmModal(null)}
              className="flex-1 py-3 rounded-2xl font-black text-muted-foreground bg-muted hover:bg-muted/80 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => { confirmModal.onConfirmar(); setConfirmModal(null); }}
              className="flex-1 py-3 rounded-2xl font-black text-primary-foreground bg-primary hover:opacity-90 transition-all"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
// ─────────────────────────────────────────────────────────────
export default function PerfilAluno() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [abaAtiva, setAbaAtiva] = useState('resumo');
  const [modalRenovarAberto, setModalRenovarAberto] = useState(false);
  const [modalEditarAberto, setModalEditarAberto] = useState(false);
  const [observacoesMedicas, setObservacoesMedicas] = useState('');
  const [salvandoMedico, setSalvandoMedico] = useState(false);

  const hoje = new Date();
  const noventa = new Date(hoje);
  noventa.setDate(hoje.getDate() - 90);
  const fmt = (d) => d.toISOString().split('T')[0];
  const [filtroInicio, setFiltroInicio] = useState(fmt(noventa));
  const [filtroFim,    setFiltroFim]    = useState(fmt(hoje));

  const { data: aluno, isLoading: loadingAluno } = useQuery({
    queryKey: ['aluno', id],
    queryFn: () => alunosService.buscarPerfilCompleto(id),
  });
  const { data: planos } = useQuery({
    queryKey: ['aluno-planos', id],
    queryFn: () => alunosService.buscarHistoricoPlanos(id),
    enabled: !!aluno,
  });
  const { data: frequencia } = useQuery({
    queryKey: ['aluno-frequencia', id],
    queryFn: () => alunosService.buscarHistoricoFrequencia(id),
    enabled: !!aluno,
  });

  React.useEffect(() => {
    if (aluno?.observacoes_medicas !== undefined) {
      setObservacoesMedicas(aluno.observacoes_medicas ?? '');
    }
  }, [aluno?.observacoes_medicas]);

  const handleRenovacaoSucesso = () => {
    queryClient.invalidateQueries(['aluno', id]);
    queryClient.invalidateQueries(['aluno-planos', id]);
  };

  if (loadingAluno) return <TableSkeleton />;

  const planoAtivo   = planos?.find(p => p.status === 'ativo') ?? null;
  const semHistorico = Array.isArray(planos) && planos.length === 0 && aluno?.plano_id;

  const abas = [
    { id: 'resumo',      label: 'Dados Gerais',    icon: <FileText size={18} />    },
    { id: 'modalidades', label: 'Modalidades',      icon: <BookOpen size={18} />    },
    { id: 'agenda',      label: 'Agenda Fixa',      icon: <CalendarDays size={18} /> },
    { id: 'planos',      label: 'Histórico',        icon: <CreditCard size={18} />  },
    { id: 'frequencia',  label: 'Frequência',       icon: <Calendar size={18} />    },
    { id: 'anamnese',    label: 'Saúde/Anamnese',   icon: <Activity size={18} />    },
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Voltar">
            <ArrowLeft size={24} />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">
              {aluno?.nome_completo}
            </h1>
            <p className="text-muted-foreground font-medium">Gestão de Aluno</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <BotaoWhatsApp aluno={aluno} />
          <Button variant="outline" size="md" leftIcon={<Edit2 size={16} />}
            onClick={() => setModalEditarAberto(true)}>
            Editar Cadastro
          </Button>
        </div>
      </div>

      {/* Aviso de histórico ausente */}
      {semHistorico && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning-soft border border-warning/30 text-warning-foreground">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-sm">Histórico de plano não registrado</p>
            <p className="text-xs font-medium mt-0.5 text-muted-foreground">
              Este aluno possui um plano vinculado, mas nenhum ciclo foi gravado em{' '}
              <code className="font-mono">historico_planos</code>. Use o botão{' '}
              <strong>Renovar / Alterar Plano</strong> na aba Histórico para registrar o ciclo atual.
            </p>
          </div>
        </div>
      )}

      {/* CARDS SUPERIORES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Surface variant="card" padding="lg" className="lg:col-span-2 flex items-center gap-6">
          <AlunoAvatar nome={aluno?.nome_completo} avatarUrl={aluno?.avatar_url} size="lg" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${aluno?.status === 'ativo' ? 'bg-success' : 'bg-destructive'}`} />
              <span className="font-bold text-muted-foreground uppercase text-xs tracking-widest">
                {aluno?.status}
              </span>
            </div>
            <h2 className="text-xl font-bold text-foreground">
              {aluno?.planos?.nome || 'Sem plano ativo'}
            </h2>
            <p className="text-muted-foreground text-sm">
              Desde {new Date(aluno?.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </Surface>
        <CardUsoPlan aluno={aluno} planos={planos} frequencia={frequencia} />
      </div>

      {/* ABAS */}
      <div className="flex gap-6 border-b border-border overflow-x-auto no-scrollbar">
        {abas.map(aba => (
          <button
            key={aba.id}
            onClick={() => setAbaAtiva(aba.id)}
            className={`pb-4 flex items-center gap-2 font-bold transition-all whitespace-nowrap px-1 ${
              abaAtiva === aba.id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {aba.icon} {aba.label}
          </button>
        ))}
      </div>

      <div className="pb-10">
        {/* ABA: Resumo / Dados Gerais */}
        {abaAtiva === 'resumo' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4">
            <Surface variant="card" padding="xl" className="space-y-8">
              <h3 className="font-black text-foreground flex items-center gap-2">
                <User size={20} className="text-primary" /> Informações Pessoais
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <LabelDado
                  titulo="Nascimento"
                  valor={
                    aluno?.data_nascimento &&
                    new Date(aluno.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR')
                  }
                />
                <LabelDado titulo="CPF" valor={aluno?.cpf} />
                <div className="col-span-2">
                  <LabelDado titulo="Contato de Emergência" valor={aluno?.contato_emergencia} />
                </div>
              </div>
            </Surface>
            <Surface variant="card" padding="xl" className="space-y-8">
              <h3 className="font-black text-foreground flex items-center gap-2">
                <MapPin size={20} className="text-primary" /> Contato e Localização
              </h3>
              <div className="grid grid-cols-1 gap-6">
                <LabelDado titulo="E-mail"              valor={aluno?.email} />
                <LabelDado titulo="Telefone / WhatsApp" valor={aluno?.telefone} />
                <div className="p-4 bg-muted rounded-2xl border border-border">
                  <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest block mb-2">
                    Endereço Registrado
                  </label>
                  {aluno?.rua ? (
                    <p className="text-foreground font-bold leading-relaxed">
                      {aluno.rua}, {aluno.numero}
                      {aluno.complemento && ` - ${aluno.complemento}`}
                      <br />
                      {aluno.bairro}{aluno.cidade && `, ${aluno.cidade}`}
                      <br />
                      <span className="text-sm font-medium text-muted-foreground">CEP {aluno.cep}</span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic font-medium">Endereço não informado.</p>
                  )}
                </div>
              </div>
            </Surface>
          </div>
        )}

        {/* ABA: Modalidades */}
        {abaAtiva === 'modalidades' && (
          <AbaModalidades aluno={aluno} alunoId={id} queryClient={queryClient} />
        )}

        {/* ABA: Agenda Fixa */}
        {abaAtiva === 'agenda' && (
          <AbaAgendaFixa aluno={aluno} alunoId={id} />
        )}

        {/* ABA: Frequência */}
        {abaAtiva === 'frequencia' && (() => {
          const inicio = new Date(filtroInicio + 'T00:00:00');
          const fim    = new Date(filtroFim    + 'T23:59:59');
          const registros = (frequencia ?? []).filter(item => {
            const d = new Date(item.data_checkin);
            return d >= inicio && d <= fim;
          });
          return (
            <div className="space-y-4 animate-in slide-in-from-bottom-4">
              <Surface variant="card" padding="lg">
                <HeatmapFrequencia frequencia={frequencia} planoAtivo={planoAtivo} />
              </Surface>
              <Surface variant="card" padding="md" className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest block">De</label>
                  <input type="date" value={filtroInicio} onChange={e => setFiltroInicio(e.target.value)}
                    className="border border-border rounded-xl px-3 py-2 text-sm font-medium text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest block">Até</label>
                  <input type="date" value={filtroFim} onChange={e => setFiltroFim(e.target.value)}
                    className="border border-border rounded-xl px-3 py-2 text-sm font-medium text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <Button variant="ghost" size="sm"
                  onClick={() => { setFiltroInicio(fmt(noventa)); setFiltroFim(fmt(hoje)); }}>
                  Últimos 90 dias
                </Button>
                <span className="ml-auto text-xs font-bold text-muted-foreground self-center">
                  {registros.length} registro{registros.length !== 1 ? 's' : ''} no período
                </span>
              </Surface>
              <Surface variant="card" padding="none" className="overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-muted/50">
                    <tr>
                      <Th>Data da Aula</Th>
                      <Th>Modalidade</Th>
                      <Th className="text-right">Status</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {registros.map(item => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-5 font-bold text-foreground">
                          {new Date(item.data_checkin).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-5 font-medium text-muted-foreground">
                          {item.agenda?.atividade}
                        </td>
                        <td className="p-5 text-right">
                          <Badge tone="success" variant="soft">
                            <CheckCircle size={12} /> Confirmada
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {registros.length === 0 && (
                      <tr>
                        <td colSpan="3" className="p-8 text-center text-muted-foreground font-medium">
                          Nenhuma frequência no período selecionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Surface>
            </div>
          );
        })()}

        {/* ABA: Planos / Histórico */}
        {abaAtiva === 'planos' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-black text-foreground text-xl">Contratos e Histórico</h3>
                <p className="text-muted-foreground text-sm">
                  Visualize ou atualize a vigência do plano deste aluno.
                </p>
              </div>
              <Button variant="brand" size="lg" onClick={() => setModalRenovarAberto(true)}>
                + Renovar / Alterar Plano
              </Button>
            </div>
            <Surface variant="card" padding="none" className="overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>Plano</Th>
                    <Th>Período</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {planos?.map(p => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-5">
                        <p className="font-bold text-foreground">{p.planos?.nome}</p>
                        <p className="text-xs font-medium text-muted-foreground">R$ {p.valor_pago}</p>
                      </td>
                      <td className="p-5">
                        <p className="font-bold text-foreground">
                          {new Date(p.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')} até{' '}
                          {new Date(p.data_fim + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </p>
                      </td>
                      <td className="p-5">
                        <Badge tone={p.status === 'ativo' ? 'success' : 'neutral'} variant="soft">
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {(!planos || planos.length === 0) && (
                    <tr>
                      <td colSpan="3" className="p-8 text-center text-muted-foreground font-medium">
                        Nenhum histórico formal de plano encontrado.
                        <br />
                        <span className="text-sm">Clique no botão acima para registrar o ciclo atual.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Surface>
          </div>
        )}

        {/* ABA: Saúde / Anamnese */}
        {abaAtiva === 'anamnese' && (
          <AbaAnamnese
            aluno={aluno}
            alunoId={id}
            queryClient={queryClient}
            observacoesMedicas={observacoesMedicas}
            setObservacoesMedicas={setObservacoesMedicas}
            salvandoMedico={salvandoMedico}
            setSalvandoMedico={setSalvandoMedico}
          />
        )}
      </div>

      {/* MODAL: Renovar Plano */}
      <ModalRenovarPlano
        isOpen={modalRenovarAberto}
        onClose={() => setModalRenovarAberto(false)}
        alunoId={id}
        onSucesso={handleRenovacaoSucesso}
      />

      {/* MODAL: Editar Cadastro */}
      {modalEditarAberto && aluno && (
        <ModalEditarCadastro
          aluno={aluno}
          alunoId={id}
          queryClient={queryClient}
          onClose={() => setModalEditarAberto(false)}
        />
      )}
    </div>
  );
}