import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import {
  ArrowLeft, User, Mail, ShieldCheck, Package, RefreshCw, Copy, Check,
  CreditCard, Calendar, Phone, MapPin, Home, CalendarDays,
  AlertTriangle, Trash2, Plus, Info, Lock, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { alunosService } from '../services/alunosService';
import { alunoSchema } from '../lib/validation';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/shared/Toast';
import Modal from '../components/ui/Modal';
import Input, { Label } from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';

// ─── Stepper header ──────────────────────────────────────────────────────────

const ETAPAS = [
  { id: 1, label: 'Identificação', icon: User },
  { id: 2, label: 'Plano', icon: Package },
  { id: 3, label: 'Turmas', icon: CalendarDays },
];

function StepperHeader({ etapaAtual, etapasCompletas, onIrParaEtapa, roleAtual }) {
  const etapasVisiveis = roleAtual === 'aluno' ? ETAPAS : ETAPAS.filter(e => e.id !== 2);

  return (
    <div className="flex items-center gap-0 mb-10 select-none">
      {etapasVisiveis.map((etapa, idx) => {
        const isAtual = etapa.id === etapaAtual;
        const isCompleta = etapasCompletas.includes(etapa.id);
        const isAcessivel = isCompleta || etapa.id === etapaAtual || (etapa.id > 1 && etapasCompletas.length > 0);
        const isUltima = idx === etapasVisiveis.length - 1;

        return (
          <React.Fragment key={etapa.id}>
            <button
              type="button"
              disabled={!isAcessivel}
              onClick={() => isAcessivel && onIrParaEtapa(etapa.id)}
              className={`flex flex-col items-center gap-1.5 transition-all disabled:cursor-not-allowed ${
                isAcessivel ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm transition-all duration-300 ${
                  isCompleta && !isAtual
                    ? 'bg-success text-success-foreground shadow-sm'
                    : isAtual
                    ? 'bg-primary text-primary-foreground shadow-lg scale-110'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isCompleta && !isAtual ? <CheckCircle2 size={18} /> : etapa.id}
              </div>
              <span
                className={`text-[11px] font-black uppercase tracking-widest transition-colors hidden md:block ${
                  isAtual
                    ? 'text-primary'
                    : isCompleta
                    ? 'text-success'
                    : 'text-muted-foreground'
                }`}
              >
                {etapa.label}
              </span>
            </button>

            {!isUltima && (
              <div className="flex-1 h-[2px] mx-2 mt-[-14px] md:mt-[-28px] rounded-full transition-colors duration-300 bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: etapasCompletas.includes(etapa.id) ? '100%' : '0%' }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Banner de credenciais ────────────────────────────────────────────────────

function BannerCredenciais({ dadosCriados, onCopiar, copiado }) {
  if (!dadosCriados) return null;
  return (
    <Surface
      variant="muted"
      padding="md"
      className="bg-success-soft border border-success/20 rounded-2xl flex flex-col md:flex-row items-start md:items-center gap-4 mb-6 animate-in fade-in slide-in-from-top-2"
    >
      <CheckCircle2 className="text-success shrink-0" size={22} />
      <div className="flex-1 min-w-0">
        <p className="font-black text-foreground text-sm">
          Conta criada para <span className="text-success">{dadosCriados.nome}</span>
        </p>
        <p className="text-xs text-muted-foreground font-medium mt-0.5">
          Login: {dadosCriados.email} · Senha provisória: Iluminus576
        </p>
      </div>
      <button
        type="button"
        onClick={onCopiar}
        className="flex items-center gap-2 text-xs font-black text-success border border-success/30 rounded-xl px-3 py-2 hover:bg-success hover:text-success-foreground transition-colors shrink-0"
      >
        {copiado ? <Check size={14} /> : <Copy size={14} />}
        {copiado ? 'Copiado!' : 'Copiar instruções'}
      </button>
    </Surface>
  );
}

// ─── Etapa 1: Identificação ───────────────────────────────────────────────────

function Etapa1({ register, errors, watch, setValue, isSubmitting, isEditing, onSubmit, buscarCep, buscandoCep }) {
  const roleAtual = watch('role');

  return (
    <form onSubmit={onSubmit} className="space-y-8 animate-in fade-in">
      <div className="space-y-4">
        <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <User size={16} /> Informações Pessoais
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input
              {...register('nome_completo')}
              placeholder="Nome Completo *"
              leftIcon={<User size={18} />}
              error={errors.nome_completo?.message}
            />
          </div>
          <Input {...register('cpf')} placeholder="CPF (Opcional)" leftIcon={<CreditCard size={18} />} />
          <Input {...register('data_nascimento')} type="date" leftIcon={<Calendar size={18} />} />
          <div className="md:col-span-2">
            <Input {...register('telefone')} placeholder="Telefone / WhatsApp" leftIcon={<Phone size={18} />} />
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <MapPin size={16} /> Endereço Residencial
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            {...register('cep')}
            onBlur={(e) => buscarCep(e.target.value)}
            placeholder={buscandoCep ? 'Buscando...' : 'CEP'}
            maxLength={9}
            leftIcon={<MapPin size={18} />}
          />
          <div className="md:col-span-2">
            <Input {...register('rua')} placeholder="Rua / Logradouro" leftIcon={<Home size={18} />} />
          </div>
          <input
            id="input-numero"
            {...register('numero')}
            placeholder="Número"
            className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground placeholder:text-muted-foreground text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring transition-all"
          />
          <div className="md:col-span-2">
            <Input {...register('bairro')} placeholder="Bairro" />
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <ShieldCheck size={16} /> Acesso ao Sistema
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input
              {...register('email')}
              type="email"
              placeholder="E-mail de acesso *"
              leftIcon={<Mail size={18} />}
              disabled={isEditing}
              error={errors.email?.message}
            />
          </div>
          <Input as="select" {...register('role')} leftIcon={<ShieldCheck size={18} />}>
            <option value="aluno">Aluno</option>
            <option value="admin">Administrador</option>
          </Input>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 pt-2">
        <Button
          type="submit"
          variant="brand"
          size="lg"
          fullWidth
          loading={isSubmitting}
          rightIcon={!isSubmitting && <ChevronRight size={18} />}
        >
          {!isSubmitting && (isEditing
            ? 'Salvar e continuar'
            : roleAtual === 'aluno'
            ? 'Criar conta e ir para Plano'
            : 'Criar conta e ir para Turmas')}
        </Button>
      </div>
    </form>
  );
}

// ─── Etapa 2: Plano ──────────────────────────────────────────────────────────

function Etapa2({
  register, watch, setValue,
  planos, modalidades, modalidadesSelecionadas,
  addModalidade, removeModalidade, getCountModEspecifca,
  getUsoPorArea, getRegraDaArea, podeAdicionarMod, modalidadesAgrupadas,
  dataVencimento, setDataVencimento,
  onSalvar, onPular, saving, isEditing,
  onVoltar,
}) {
  const planoSelecionado = watch('plano_id');
  const planoSelecionadoObj = planos.find(p => String(p.id) === String(planoSelecionado));
  const regrasPlano = planoSelecionadoObj?.regras_acesso || [];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Input as="select" {...register('plano_id')} leftIcon={<Package size={18} />}>
            <option value="">Vincular Plano...</option>
            {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Input>
        </div>

        {planoSelecionado && (
          <div className="md:col-span-2 animate-in fade-in">
            <Surface variant="muted" padding="md" className="border border-info/20 bg-info-soft rounded-2xl">
              <Label className="text-info-foreground mb-2">Data do 1º Pagamento</Label>
              <Input
                type="date"
                value={dataVencimento}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDataVencimento(e.target.value)}
                className="bg-card"
              />
              <p className="text-[11px] text-info font-medium mt-2">
                O plano terá validade contando a partir desta data de pagamento.
              </p>
            </Surface>
          </div>
        )}

        {planoSelecionado && (
          <div className="md:col-span-2 mt-2 animate-in slide-in-from-top-4 space-y-6">
            <Surface variant="muted" padding="md" className="border border-info/20 bg-info-soft rounded-3xl">
              <div className="flex items-center gap-2 mb-3">
                <Info className="text-info" size={20} />
                <h4 className="font-black text-foreground text-lg">
                  Regras do Plano: {planoSelecionadoObj?.nome}
                </h4>
              </div>
              {regrasPlano.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {regrasPlano.map((r, i) => {
                    const usoAtual = getUsoPorArea(r.modalidade);
                    const limiteText = r.limite === 999 ? 'Ilimitado' : `${r.limite}x`;
                    const isFull = r.limite !== 999 && usoAtual >= r.limite;
                    return (
                      <span
                        key={i}
                        className={`border px-4 py-2 rounded-xl font-bold text-sm transition-colors ${
                          isFull ? 'bg-info text-info-foreground border-info' : 'bg-card text-info border-info/30'
                        }`}
                      >
                        {limiteText} na Área: {r.modalidade}
                        {isFull && <Check size={14} className="inline ml-1" />}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground font-medium">
                  Este plano não possui regras cadastradas.
                </p>
              )}
            </Surface>

            <div className="space-y-6">
              {Object.entries(modalidadesAgrupadas).map(([areaNome, modsArea]) => {
                const regra = getRegraDaArea(areaNome);
                const isAreaBloqueada = !regra;
                return (
                  <div
                    key={areaNome}
                    className={`p-5 rounded-3xl border-2 transition-opacity ${
                      isAreaBloqueada ? 'bg-muted border-dashed border-border opacity-60' : 'bg-card border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-black text-muted-foreground uppercase tracking-widest text-xs flex items-center gap-2">
                        Área: {areaNome}
                        {isAreaBloqueada && <Lock size={14} className="text-muted-foreground" />}
                      </h4>
                      {!isAreaBloqueada && regra.limite !== 999 && (
                        <span className="text-xs font-bold text-info bg-info-soft px-2 py-1 rounded-md">
                          Usado: {getUsoPorArea(areaNome)} / {regra.limite}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {modsArea.map(mod => {
                        const count = getCountModEspecifca(mod.id);
                        const isAtivo = count > 0;
                        const allowAdd = podeAdicionarMod(areaNome);
                        return (
                          <div
                            key={mod.id}
                            className={`flex items-center justify-between p-3 rounded-xl transition-all ${
                              isAreaBloqueada
                                ? 'bg-muted'
                                : isAtivo
                                  ? 'bg-primary-soft/50 border border-primary/20'
                                  : 'bg-muted border border-transparent'
                            }`}
                          >
                            <span className={`text-sm font-bold ${isAtivo ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {mod.nome}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => removeModalidade(mod.id)}
                                disabled={!isAtivo}
                                className="w-7 h-7 flex items-center justify-center rounded-lg bg-card shadow-sm text-muted-foreground font-black hover:bg-destructive-soft hover:text-destructive disabled:opacity-30 disabled:shadow-none transition-colors"
                              >
                                -
                              </button>
                              <span className={`font-black w-4 text-center text-sm ${isAtivo ? 'text-primary' : 'text-muted-foreground'}`}>
                                {count}x
                              </span>
                              <button
                                type="button"
                                onClick={() => addModalidade(mod.id)}
                                disabled={!allowAdd || isAreaBloqueada}
                                className={`w-7 h-7 flex items-center justify-center rounded-lg bg-card shadow-sm font-black transition-colors ${
                                  !allowAdd || isAreaBloqueada
                                    ? 'opacity-30 shadow-none text-muted-foreground cursor-not-allowed'
                                    : 'text-info hover:bg-info-soft hover:text-info'
                                }`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-3 pt-4 border-t border-border">
        <Button type="button" variant="ghost" size="lg" onClick={onVoltar} leftIcon={<ArrowLeft size={18} />} className="md:w-auto">
          Voltar
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onPular} className="md:w-auto text-muted-foreground">
          Pular por agora
        </Button>
        <Button type="button" variant="brand" size="lg" fullWidth loading={saving} onClick={onSalvar} rightIcon={!saving && <ChevronRight size={18} />}>
          {!saving && 'Salvar Plano e ir para Turmas'}
        </Button>
      </div>
    </div>
  );
}

// ─── Etapa 3: Turmas ─────────────────────────────────────────────────────────

function Etapa3({
  loadingAgenda, listaModalidadesAgenda, aulasGrade,
  matriculasAluno, getCountModEspecifca, countUsoModNaGrade,
  toggleMatriculaFixa, onConcluir, onVoltar, roleAtual, isEditing,
}) {
  return (
    <div className="space-y-6 animate-in fade-in">
      <Surface variant="muted" padding="md" className="bg-primary-soft border border-primary/20 rounded-2xl flex flex-col md:flex-row items-start gap-4">
        <AlertTriangle className="text-primary shrink-0 mt-1 hidden md:block" size={24} />
        <div>
          <h4 className="font-black text-foreground">Gerenciamento de Turmas Regulares</h4>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Matricule o aluno nas turmas fixas que ele selecionou.
          </p>
        </div>
      </Surface>

      {loadingAgenda ? (
        <div className="flex justify-center p-12">
          <RefreshCw className="animate-spin text-muted-foreground" size={32} />
        </div>
      ) : (
        <div className="space-y-8">
          {listaModalidadesAgenda.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 bg-muted rounded-2xl border border-dashed border-border">
              {roleAtual !== 'aluno'
                ? 'Turmas não aplicáveis para este perfil.'
                : 'Nenhuma modalidade configurada no perfil deste aluno ainda. Configure um plano primeiro.'}
            </p>
          ) : (
            listaModalidadesAgenda.map(modObj => {
              const limite = getCountModEspecifca(modObj.id);
              const usado = countUsoModNaGrade(modObj.id);
              const isFull = usado >= limite;
              const turmasDessaMod = aulasGrade.filter(a => a.modalidades?.id === modObj.id);
              if (turmasDessaMod.length === 0) return null;
              return (
                <Surface key={modObj.id} variant="card" padding="none" className="overflow-hidden">
                  <div className="bg-muted border-b border-border p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                    <h3 className="font-black text-foreground text-lg">{modObj.nome}</h3>
                    <span className={`px-3 py-1 rounded-lg font-black text-xs uppercase tracking-wider ${
                      isFull ? 'bg-primary-soft text-primary' : 'bg-success-soft text-success'
                    }`}>
                      Vagas: {usado} de {limite}
                    </span>
                  </div>
                  <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {turmasDessaMod.map(aula => {
                      const isMatriculado = matriculasAluno.includes(aula.id);
                      return (
                        <div
                          key={aula.id}
                          className={`p-4 rounded-2xl border-2 flex justify-between items-center transition-all ${
                            isMatriculado ? 'border-success/30 bg-success-soft/30' : 'border-border bg-card hover:border-subtle'
                          }`}
                        >
                          <div>
                            <p className="font-black text-foreground">{aula.dia_semana}</p>
                            <p className="text-sm font-medium text-muted-foreground">
                              {aula.horario.slice(0, 5)} – {aula.atividade}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleMatriculaFixa(aula)}
                            className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors ${
                              isMatriculado
                                ? 'bg-destructive-soft text-destructive hover:bg-destructive/20'
                                : 'bg-muted text-muted-foreground hover:bg-success hover:text-success-foreground'
                            }`}
                          >
                            {isMatriculado ? <Trash2 size={18} /> : <Plus size={18} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </Surface>
              );
            })
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 pt-4 border-t border-border">
        {roleAtual === 'aluno' && (
          <Button type="button" variant="ghost" size="lg" onClick={onVoltar} leftIcon={<ArrowLeft size={18} />} className="md:w-auto">
            Voltar
          </Button>
        )}
        <Button type="button" variant="brand" size="lg" fullWidth onClick={onConcluir} leftIcon={<CheckCircle2 size={18} />}>
          {isEditing ? 'Salvar e voltar' : 'Concluir Cadastro'}
        </Button>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NovoAluno() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const alunoParaEditar = location.state?.alunoParaEditar || null;
  const leadParaConversao = location.state?.leadParaConversao || null;

  const [etapaAtual, setEtapaAtual] = useState(1);
  const [etapasCompletas, setEtapasCompletas] = useState(alunoParaEditar ? [1, 2] : []);
  const [alunoId, setAlunoId] = useState(alunoParaEditar?.id || null);

  const [planos, setPlanos] = useState([]);
  const [modalidades, setModalidades] = useState([]);
  const [modalidadesSelecionadas, setModalidadesSelecionadas] = useState([]);
  const [aulasGrade, setAulasGrade] = useState([]);
  const [matriculasAluno, setMatriculasAluno] = useState([]);
  const [loadingAgenda, setLoadingAgenda] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [dadosCriados, setDadosCriados] = useState(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [dataVencimento, setDataVencimento] = useState(new Date().toISOString().split('T')[0]);
  const [savingEtapa2, setSavingEtapa2] = useState(false);

  const {
    register, handleSubmit, watch, reset, setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(alunoSchema),
    defaultValues: { role: 'aluno' },
  });

  const roleAtual = watch('role');
  const planoSelecionado = watch('plano_id');
  const planoSelecionadoObj = planos.find(p => String(p.id) === String(planoSelecionado));
  const regrasPlano = planoSelecionadoObj?.regras_acesso || [];

  useEffect(() => {
    if (!alunoParaEditar && !leadParaConversao) {
      reset({ nome_completo: '', email: '', role: 'aluno' });
      setModalidadesSelecionadas([]);
      setEtapaAtual(1);
      setEtapasCompletas([]);
      setAlunoId(null);
      setDadosCriados(null);
    }
  }, [location.pathname]);

  useEffect(() => {
    async function carregarDados() {
      const { data: planosData } = await supabase.from('planos').select('*').order('nome');
      setPlanos(planosData || []);
      const { data: modData } = await supabase.from('modalidades').select('id, nome, area').order('area').order('nome');
      setModalidades(modData || []);
    }
    carregarDados();
  }, []);

  useEffect(() => {
    async function carregarFichaCompleta() {
      if (alunoParaEditar?.id) {
        const { data: alunoCompleto, error } = await supabase
          .from('alunos').select('*').eq('id', alunoParaEditar.id).single();
        if (alunoCompleto && !error) {
          reset({
            nome_completo: alunoCompleto.nome_completo || '',
            email: alunoCompleto.email || '',
            role: alunoCompleto.role || 'aluno',
            plano_id: alunoCompleto.plano_id || '',
            cpf: alunoCompleto.cpf || '',
            data_nascimento: alunoCompleto.data_nascimento || '',
            telefone: alunoCompleto.telefone || '',
            cep: alunoCompleto.cep || '',
            rua: alunoCompleto.rua || '',
            numero: alunoCompleto.numero || '',
            bairro: alunoCompleto.bairro || '',
          });
          setModalidadesSelecionadas(alunoCompleto.modalidades_selecionadas || []);
        }
      } else if (leadParaConversao) {
        reset({
          nome_completo: leadParaConversao.nome_visitante || '',
          telefone: leadParaConversao.telefone_visitante || '',
          role: 'aluno',
        });
      }
    }
    carregarFichaCompleta();
  }, [alunoParaEditar, reset]);

  useEffect(() => {
    if (etapaAtual === 3 && alunoId) carregarAgendaFixa();
  }, [etapaAtual, alunoId]);

  function marcarCompleta(n) {
    setEtapasCompletas(prev => prev.includes(n) ? prev : [...prev, n]);
  }

  const buscarCep = async (cep) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await response.json();
      if (!data.erro) {
        setValue('rua', data.logradouro, { shouldValidate: true });
        setValue('bairro', data.bairro, { shouldValidate: true });
        document.getElementById('input-numero')?.focus();
      }
    } finally {
      setBuscandoCep(false);
    }
  };

  async function carregarAgendaFixa() {
    if (!alunoId) return;
    setLoadingAgenda(true);
    try {
      const { data: aulas } = await supabase
        .from('agenda').select('*, modalidades(id, nome)').eq('eh_recorrente', true);
      const diasOrdem = {
        'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2, 'Quarta-feira': 3,
        'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6,
      };
      const aulasOrdenadas = (aulas || []).sort((a, b) => {
        if (diasOrdem[a.dia_semana] !== diasOrdem[b.dia_semana])
          return diasOrdem[a.dia_semana] - diasOrdem[b.dia_semana];
        return a.horario.localeCompare(b.horario);
      });
      setAulasGrade(aulasOrdenadas);
      const { data: matriculas } = await supabase
        .from('agenda_fixa').select('aula_id').eq('aluno_id', alunoId);
      setMatriculasAluno(matriculas?.map(m => m.aula_id) || []);
    } catch {
      showToast.error('Erro ao carregar grade fixa.');
    } finally {
      setLoadingAgenda(false);
    }
  }

  // ── Modalidades ────────────────────────────────────────────────────────────

  const getCountModEspecifca = (modId) =>
    modalidadesSelecionadas.filter(id => id === modId).length;
  const getUsoPorArea = (areaNome) =>
    modalidadesSelecionadas.filter(id => modalidades.find(m => m.id === id)?.area === areaNome).length;
  const getRegraDaArea = (areaNome) => regrasPlano.find(r => r.modalidade === areaNome);
  const podeAdicionarMod = (modArea) => {
    const regra = getRegraDaArea(modArea);
    if (!regra) return false;
    if (regra.limite === 999) return true;
    return getUsoPorArea(modArea) < regra.limite;
  };
  const addModalidade = (modId) => setModalidadesSelecionadas([...modalidadesSelecionadas, modId]);
  const removeModalidade = (modId) => {
    const index = modalidadesSelecionadas.lastIndexOf(modId);
    if (index > -1) {
      const novaLista = [...modalidadesSelecionadas];
      novaLista.splice(index, 1);
      setModalidadesSelecionadas(novaLista);
    }
  };
  const modalidadesAgrupadas = modalidades.reduce((acc, mod) => {
    const area = mod.area || 'Outros';
    if (!acc[area]) acc[area] = [];
    acc[area].push(mod);
    return acc;
  }, {});

  // ── Agenda ─────────────────────────────────────────────────────────────────

  const countUsoModNaGrade = (modId) =>
    matriculasAluno.filter(aulaId => aulasGrade.find(a => a.id === aulaId)?.modalidades?.id === modId).length;

  async function toggleMatriculaFixa(aula) {
    const isMatriculado = matriculasAluno.includes(aula.id);
    const modId = aula.modalidades?.id;
    const modNome = aula.modalidades?.nome;
    if (!isMatriculado) {
      const limiteSelecionado = getCountModEspecifca(modId);
      const usado = countUsoModNaGrade(modId);
      if (usado >= limiteSelecionado) {
        const ok = window.confirm(
          `ATENÇÃO: Você selecionou apenas ${limiteSelecionado}x de ${modNome} no perfil do aluno.\n\nDeseja abrir uma exceção e matricular na ${usado + 1}ª turma?`
        );
        if (!ok) return;
      }
      try {
        const { error } = await supabase.from('agenda_fixa').insert({ aluno_id: alunoId, aula_id: aula.id });
        if (error) throw error;
        showToast.success('Aluno matriculado na turma!');
        carregarAgendaFixa();
      } catch {
        showToast.error('Erro ao matricular na turma.');
      }
    } else {
      if (!window.confirm(`Deseja remover o aluno definitivamente da turma de ${aula.dia_semana} às ${aula.horario}?`)) return;
      try {
        const { error } = await supabase.from('agenda_fixa').delete().match({ aluno_id: alunoId, aula_id: aula.id });
        if (error) throw error;
        showToast.success('Aluno removido da turma.');
        carregarAgendaFixa();
      } catch {
        showToast.error('Erro ao remover da turma.');
      }
    }
  }

  // ── Credenciais ────────────────────────────────────────────────────────────

  const copiarInstrucoes = () => {
    if (!dadosCriados) return;
    const texto = `Olá ${dadosCriados.nome}!\nSeu cadastro no Espaço Iluminus foi criado.\n\nAcesse: ${window.location.origin}\nLogin: ${dadosCriados.email}\nSenha Provisória: Iluminus576\n\nO sistema pedirá para você criar uma nova senha no primeiro acesso.`;
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
    showToast.success('Instruções copiadas!');
  };

  // ── Submits ────────────────────────────────────────────────────────────────

  const onSubmitEtapa1 = handleSubmit(async (data) => {
    try {
      const payloadPessoal = {
        cpf: data.cpf || null,
        data_nascimento: data.data_nascimento || null,
        telefone: data.telefone || null,
        cep: data.cep || null,
        rua: data.rua || null,
        numero: data.numero || null,
        bairro: data.bairro || null,
        nome_completo: data.nome_completo,
      };

      if (alunoParaEditar) {
        await alunosService.atualizar(alunoParaEditar.id, payloadPessoal);
        showToast.success('Dados pessoais atualizados!');
        await queryClient.invalidateQueries({ queryKey: ['alunos'] });
        marcarCompleta(1);
        setEtapaAtual(roleAtual === 'aluno' ? 2 : 3);
        return;
      }

      const { data: profExistente } = await supabase
        .from('professores').select('auth_id').eq('email', data.email.trim()).maybeSingle();

      let novoAlunoId = null;

      if (profExistente) {
        const { data: alunoInserido, error: insertError } = await supabase
          .from('alunos')
          .insert([{ ...payloadPessoal, auth_id: profExistente.auth_id, email: data.email.trim() }])
          .select('id').single();
        if (insertError) throw new Error('Erro ao criar vínculo de aluno.');
        novoAlunoId = alunoInserido.id;
        showToast.success('Perfil vinculado ao professor com sucesso!');
      } else {
        const { data: funcData, error: funcError } = await supabase.functions.invoke('criar_usuario', {
          body: { email: data.email.trim(), nome: data.nome_completo, role: data.role || 'aluno' },
        });
        if (funcError) throw new Error('Falha na comunicação com o servidor seguro.');
        if (funcData?.error) {
          throw new Error(funcData.error === 'User already registered'
            ? 'Este e-mail já possui um acesso.'
            : funcData.error);
        }
        const tabela = data.role === 'professor' ? 'professores' : 'alunos';
        const { data: alunoAtualizado, error: updateError } = await supabase
          .from(tabela).update(payloadPessoal).eq('auth_id', funcData.user.id).select('id').single();
        if (updateError) throw new Error('Erro ao salvar os dados do formulário.');
        novoAlunoId = alunoAtualizado?.id;
      }

      if (leadParaConversao?.id) {
        const payloadConversao = { status_conversao: 'convertido' };
        if (novoAlunoId) payloadConversao.aluno_id = novoAlunoId;
        await supabase.from('presencas').update(payloadConversao).eq('id', leadParaConversao.id);
      }

      setAlunoId(novoAlunoId);
      setDadosCriados({ nome: data.nome_completo, email: data.email });
      marcarCompleta(1);
      await queryClient.invalidateQueries({ queryKey: ['alunos', 'professores', 'presencas'] });
      showToast.success('Conta criada! Agora configure o plano.');
      setEtapaAtual(roleAtual === 'aluno' ? 2 : 3);
    } catch (error) {
      showToast.error(error.message || 'Erro ao processar a solicitação.');
    }
  });

  // ── Etapa 2: delega para alunosService.matricular() ────────────────────────
  async function salvarEtapa2() {
    if (!alunoId || !planoSelecionado) {
      // Sem plano selecionado — apenas salva modalidades e avança
      await alunosService.atualizar(alunoId, { modalidades_selecionadas: modalidadesSelecionadas });
      await queryClient.invalidateQueries({ queryKey: ['alunos'] });
      marcarCompleta(2);
      showToast.success('Preferências salvas!');
      setEtapaAtual(3);
      return;
    }
    setSavingEtapa2(true);
    try {
      await alunosService.matricular(alunoId, planoSelecionado, {
        dataVencimento,
        modalidades: modalidadesSelecionadas,
        // Em modo edição não duplica historico_planos
        isNovaMatricula: !alunoParaEditar,
      });
      await queryClient.invalidateQueries({ queryKey: ['alunos'] });
      marcarCompleta(2);
      showToast.success('Plano salvo!');
      setEtapaAtual(3);
    } catch (error) {
      showToast.error(error.message || 'Erro ao salvar plano.');
    } finally {
      setSavingEtapa2(false);
    }
  }

  async function concluir() {
    await queryClient.invalidateQueries({ queryKey: ['alunos'] });
    if (dadosCriados && !alunoParaEditar) {
      setModalOpen(true);
    } else {
      navigate('/alunos');
    }
  }

  const modalidadesUnicasIDs = [...new Set(modalidadesSelecionadas)];
  const listaModalidadesAgenda = modalidadesUnicasIDs
    .map(id => modalidades.find(m => m.id === id))
    .filter(Boolean);

  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={() => navigate('/alunos')}
        className="flex items-center gap-2 text-muted-foreground hover:text-primary font-bold mb-6 transition-colors"
      >
        <ArrowLeft size={20} /> Voltar para lista
      </button>

      <Surface variant="card" padding="xl" className="w-full">
        <h1 className="text-2xl md:text-3xl font-black text-foreground mb-8">
          {alunoParaEditar ? 'Perfil do Membro' : 'Novo Cadastro'}
        </h1>

        <StepperHeader
          etapaAtual={etapaAtual}
          etapasCompletas={etapasCompletas}
          roleAtual={roleAtual}
          onIrParaEtapa={(n) => {
            if (etapasCompletas.includes(n) || n === etapaAtual || (n > 1 && alunoId)) {
              setEtapaAtual(n);
            }
          }}
        />

        {dadosCriados && (etapaAtual === 2 || etapaAtual === 3) && (
          <BannerCredenciais dadosCriados={dadosCriados} onCopiar={copiarInstrucoes} copiado={copiado} />
        )}

        {etapaAtual === 1 && (
          <Etapa1
            register={register} errors={errors} watch={watch} setValue={setValue}
            isSubmitting={isSubmitting} isEditing={!!alunoParaEditar}
            onSubmit={onSubmitEtapa1} buscarCep={buscarCep} buscandoCep={buscandoCep}
          />
        )}

        {etapaAtual === 2 && (
          <Etapa2
            register={register} watch={watch} setValue={setValue}
            planos={planos} modalidades={modalidades}
            modalidadesSelecionadas={modalidadesSelecionadas}
            addModalidade={addModalidade} removeModalidade={removeModalidade}
            getCountModEspecifca={getCountModEspecifca} getUsoPorArea={getUsoPorArea}
            getRegraDaArea={getRegraDaArea} podeAdicionarMod={podeAdicionarMod}
            modalidadesAgrupadas={modalidadesAgrupadas}
            dataVencimento={dataVencimento} setDataVencimento={setDataVencimento}
            onSalvar={salvarEtapa2}
            onPular={() => { marcarCompleta(2); setEtapaAtual(3); }}
            saving={savingEtapa2} isEditing={!!alunoParaEditar}
            onVoltar={() => setEtapaAtual(1)}
          />
        )}

        {etapaAtual === 3 && (
          <Etapa3
            loadingAgenda={loadingAgenda}
            listaModalidadesAgenda={listaModalidadesAgenda}
            aulasGrade={aulasGrade} matriculasAluno={matriculasAluno}
            getCountModEspecifca={getCountModEspecifca}
            countUsoModNaGrade={countUsoModNaGrade}
            toggleMatriculaFixa={toggleMatriculaFixa}
            onConcluir={concluir}
            onVoltar={() => roleAtual === 'aluno' && setEtapaAtual(2)}
            roleAtual={roleAtual} isEditing={!!alunoParaEditar}
          />
        )}
      </Surface>

      <Modal
        aberto={modalOpen}
        fechar={() => { setModalOpen(false); navigate('/alunos'); }}
        title="Cadastro Concluído!"
        size="sm"
      >
        <p className="text-muted-foreground text-sm mb-6">
          Copie e envie as instruções de acesso para{' '}
          <strong className="text-foreground">{dadosCriados?.nome}</strong>.
        </p>
        <Button
          variant="primary" size="lg" fullWidth
          leftIcon={copiado ? <Check size={20} /> : <Copy size={20} />}
          onClick={copiarInstrucoes}
        >
          {copiado ? 'Copiado!' : 'Copiar Instruções de Acesso'}
        </Button>
      </Modal>
    </div>
  );
}