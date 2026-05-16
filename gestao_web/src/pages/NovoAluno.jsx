import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import {
  ArrowLeft, User, Mail, ShieldCheck, Package, RefreshCw, Copy, Check,
  CreditCard, Calendar, Phone, MapPin, Home, CheckCircle2, CalendarDays,
  AlertTriangle, Trash2, Plus, Info, Lock,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { alunosService } from '../services/alunosService';
import { alunoSchema } from '../lib/validation';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/shared/Toast';
// ✅ Design System
import Modal from '../components/ui/Modal';
import Input, { Label } from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';

export default function NovoAluno() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const alunoParaEditar = location.state?.alunoParaEditar || null;
  const leadParaConversao = location.state?.leadParaConversao || null;

  useEffect(() => {
    if (!alunoParaEditar && !leadParaConversao) {
      reset({ nome_completo: '', email: '', role: 'aluno' });
      setModalidadesSelecionadas([]);
    }
  }, [location.pathname]);

  const [abaAtiva, setAbaAtiva] = useState('dados');
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

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: yupResolver(alunoSchema),
    defaultValues: { role: 'aluno' },
  });

  const roleAtual = watch('role');
  const planoSelecionado = watch('plano_id');
  const dataInicioPlano = watch('data_inicio_plano');

  const planoSelecionadoObj = planos.find(p => String(p.id) === String(planoSelecionado));
  const regrasPlano = planoSelecionadoObj?.regras_acesso || [];

  useEffect(() => {
    if (planoSelecionadoObj && dataInicioPlano) {
      const duracaoMeses = planoSelecionadoObj.duracao_meses || 1;
      const dataInicio = new Date(dataInicioPlano + 'T12:00:00');
      const dataFim = new Date(dataInicio);
      dataFim.setMonth(dataFim.getMonth() + duracaoMeses);
      dataFim.setDate(dataFim.getDate() - 1);
      setValue('data_fim_plano', dataFim.toISOString().split('T')[0], { shouldValidate: true });
    }
  }, [planoSelecionadoObj, dataInicioPlano, setValue]);

  useEffect(() => {
    async function carregarDados() {
      const { data: planosData } = await supabase.from('planos').select('*').order('nome');
      setPlanos(planosData || []);
      const { data: modData } = await supabase.from('modalidades').select('id, nome, area').order('area').order('nome');
      setModalidades(modData || []);
    }
    carregarDados();

    async function carregarFichaCompleta() {
      if (alunoParaEditar && alunoParaEditar.id) {
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
            data_inicio_plano: alunoCompleto.data_inicio_plano || '',
            data_fim_plano: alunoCompleto.data_fim_plano || '',
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
    if (abaAtiva === 'agenda' && alunoParaEditar) carregarAgendaFixa();
  }, [abaAtiva, alunoParaEditar]);

  async function carregarAgendaFixa() {
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
        .from('agenda_fixa').select('aula_id').eq('aluno_id', alunoParaEditar.id);
      setMatriculasAluno(matriculas?.map(m => m.aula_id) || []);
    } catch {
      showToast.error('Erro ao carregar grade fixa.');
    } finally {
      setLoadingAgenda(false);
    }
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

  const getCountModEspecifca = (modId) => modalidadesSelecionadas.filter(id => id === modId).length;
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
        const { error } = await supabase.from('agenda_fixa').insert({ aluno_id: alunoParaEditar.id, aula_id: aula.id });
        if (error) throw error;
        showToast.success('Aluno matriculado na turma!');
        carregarAgendaFixa();
      } catch {
        showToast.error('Erro ao matricular na turma.');
      }
    } else {
      if (!window.confirm(`Deseja remover o aluno definitivamente da turma de ${aula.dia_semana} às ${aula.horario}?`)) return;
      try {
        const { error } = await supabase.from('agenda_fixa').delete().match({ aluno_id: alunoParaEditar.id, aula_id: aula.id });
        if (error) throw error;
        showToast.success('Aluno removido da turma.');
        carregarAgendaFixa();
      } catch {
        showToast.error('Erro ao remover da turma.');
      }
    }
  }

  const calcularDataFim = (dataVencimentoStr, mesesAdicionais) => {
    if (!dataVencimentoStr || !mesesAdicionais) return '';
    const d = new Date(dataVencimentoStr + 'T12:00:00');
    d.setDate(d.getDate() + Number(mesesAdicionais) * 30);
    return d.toISOString().split('T')[0];
  };

  async function onSubmit(data) {
    try {
      const planoFinal = (data.role === 'aluno' && data.plano_id && data.plano_id !== '') ? data.plano_id : null;
      let planoInfos = null;

      const payloadBase = {
        plano_id: planoFinal,
        modalidades_selecionadas: data.role === 'aluno' ? modalidadesSelecionadas : [],
        data_inicio_plano: data.data_inicio_plano || null,
        data_fim_plano: data.data_fim_plano || null,
        cpf: data.cpf || null,
        data_nascimento: data.data_nascimento || null,
        telefone: data.telefone || null,
        cep: data.cep || null,
        rua: data.rua || null,
        numero: data.numero || null,
        bairro: data.bairro || null,
      };

      if (planoFinal) {
        planoInfos = planos.find(p => String(p.id) === String(planoFinal));
        if (planoInfos) {
          const meses = planoInfos.duracao_meses || 1;
          payloadBase.data_inicio_plano = new Date().toISOString().split('T')[0];
          payloadBase.data_fim_plano = calcularDataFim(dataVencimento, meses);
        }
      }

      // MODO EDIÇÃO
      if (alunoParaEditar) {
        await alunosService.atualizar(alunoParaEditar.id, { ...payloadBase, nome_completo: data.nome_completo });
        showToast.success('Cadastro atualizado com sucesso!');
        await queryClient.invalidateQueries({ queryKey: ['alunos'] });
        navigate('/alunos');
        return;
      }

      // MODO CRIAÇÃO
      let novoAlunoId = null;
      const { data: profExistente } = await supabase.from('professores').select('auth_id').eq('email', data.email.trim()).maybeSingle();

      if (profExistente) {
        const { data: alunoInserido, error: insertError } = await supabase.from('alunos').insert([{
          ...payloadBase,
          auth_id: profExistente.auth_id,
          nome_completo: data.nome_completo,
          email: data.email.trim(),
        }]).select('id').single();
        if (insertError) throw new Error('Erro ao criar vínculo de aluno.');
        novoAlunoId = alunoInserido.id;
        showToast.success('Perfil vinculado ao professor com sucesso!');
      } else {
        const { data: funcData, error: funcError } = await supabase.functions.invoke('criar_usuario', {
          body: { email: data.email.trim(), nome: data.nome_completo, role: data.role || 'aluno' },
        });
        if (funcError) throw new Error('Falha na comunicação com o servidor seguro.');
        if (funcData?.error) throw new Error(funcData.error === 'User already registered' ? 'Este e-mail já possui um acesso.' : funcData.error);

        const { data: alunoAtualizado, error: updateError } = await supabase
          .from(data.role === 'professor' ? 'professores' : 'alunos')
          .update(payloadBase).eq('auth_id', funcData.user.id).select('id').single();
        if (updateError) throw new Error('Erro ao salvar os dados do formulário.');
        novoAlunoId = alunoAtualizado?.id;
        showToast.success('Cadastro criado com sucesso!');
      }

      if (novoAlunoId && planoFinal && planoInfos) {
        const { error: errHist } = await supabase.from('historico_planos').insert([{
          aluno_id: novoAlunoId, plano_id: planoFinal,
          data_inicio: payloadBase.data_inicio_plano, data_fim: payloadBase.data_fim_plano,
          status: 'ativo', valor_pago: planoInfos.preco || 0,
        }]);
        if (errHist) console.error('Erro no histórico:', errHist);

        const { error: errMensalidade } = await supabase.from('mensalidades').insert([{
          aluno_id: novoAlunoId, plano_id: planoFinal,
          data_vencimento: dataVencimento, status: 'pendente',
        }]);
        if (errMensalidade) console.error('Erro na mensalidade:', errMensalidade);
      }

      if (leadParaConversao && leadParaConversao.id) {
        const payloadConversao = { status_conversao: 'convertido' };
        if (novoAlunoId) payloadConversao.aluno_id = novoAlunoId;
        await supabase.from('presencas').update(payloadConversao).eq('id', leadParaConversao.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['alunos', 'professores', 'presencas'] });

      if (!profExistente) {
        setDadosCriados({ nome: data.nome_completo, email: data.email });
        setModalOpen(true);
      } else {
        navigate('/alunos');
      }
    } catch (error) {
      showToast.error(error.message || 'Erro ao processar a solicitação.');
    }
  }

  const copiarInstrucoes = () => {
    const texto = `Olá ${dadosCriados.nome}!\nSeu cadastro no Espaço Iluminus foi criado.\n\nAcesse: ${window.location.origin}\nLogin: ${dadosCriados.email}\nSenha Provisória: Iluminus576\n\nO sistema pedirá para você criar uma nova senha no primeiro acesso.`;
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
    showToast.success('Instruções copiadas!');
  };

  const modalidadesUnicasIDs = [...new Set(modalidadesSelecionadas)];
  const listaModalidadesAgenda = modalidadesUnicasIDs.map(id => modalidades.find(m => m.id === id)).filter(Boolean);

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Voltar */}
      <button
        onClick={() => navigate('/alunos')}
        className="flex items-center gap-2 text-muted-foreground hover:text-primary font-bold mb-6 transition-colors"
      >
        <ArrowLeft size={20} /> Voltar para lista
      </button>

      {/* Card principal */}
      <Surface variant="card" padding="xl" className="w-full">
        <h1 className="text-2xl md:text-3xl font-black text-foreground mb-6">
          {alunoParaEditar ? 'Perfil do Membro' : 'Novo Cadastro'}
        </h1>

        {/* ── Abas ── */}
        <div className="flex gap-6 border-b border-border mb-8 overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setAbaAtiva('dados')}
            className={`pb-4 font-black uppercase tracking-wider text-sm transition-all border-b-2 whitespace-nowrap ${
              abaAtiva === 'dados' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Dados Cadastrais
          </button>
          <button
            onClick={() => setAbaAtiva('agenda')}
            disabled={!alunoParaEditar}
            className={`pb-4 font-black uppercase tracking-wider text-sm transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${
              abaAtiva === 'agenda'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            <CalendarDays size={18} /> Agenda Fixa (Turmas)
          </button>
        </div>

        {/* ══════════════════════════ ABA: DADOS ══════════════════════════ */}
        {abaAtiva === 'dados' && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 animate-in fade-in">

            {/* INFORMAÇÕES PESSOAIS */}
            <div className="space-y-4">
              <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                <User size={16} /> Informações Pessoais
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Input
                    {...register('nome_completo')}
                    placeholder="Nome Completo *"
                    leftIcon={<User size={18} />}
                  />
                </div>
                <Input
                  {...register('cpf')}
                  placeholder="CPF (Opcional)"
                  leftIcon={<CreditCard size={18} />}
                />
                <Input
                  {...register('data_nascimento')}
                  type="date"
                  leftIcon={<Calendar size={18} />}
                />
                <div className="md:col-span-2">
                  <Input
                    {...register('telefone')}
                    placeholder="Telefone / WhatsApp"
                    leftIcon={<Phone size={18} />}
                  />
                </div>
              </div>
            </div>

            {/* ENDEREÇO */}
            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                <MapPin size={16} /> Endereço Residencial
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  {...register('cep')}
                  onBlur={(e) => buscarCep(e.target.value)}
                  placeholder="CEP"
                  maxLength={9}
                  leftIcon={<MapPin size={18} />}
                />
                <div className="md:col-span-2">
                  <Input
                    {...register('rua')}
                    placeholder="Rua / Logradouro"
                    leftIcon={<Home size={18} />}
                  />
                </div>
                <input
                  id="input-numero"
                  {...register('numero')}
                  placeholder="Número"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground placeholder:text-muted-foreground text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring transition-all"
                />
                <div className="md:col-span-2">
                  <Input
                    {...register('bairro')}
                    placeholder="Bairro"
                  />
                </div>
              </div>
            </div>

            {/* ACESSO E PLANO */}
            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                <ShieldCheck size={16} /> Acesso e Plano
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Email */}
                <div className="md:col-span-2">
                  <Input
                    {...register('email')}
                    type="email"
                    placeholder="E-mail de acesso *"
                    leftIcon={<Mail size={18} />}
                    disabled={!!alunoParaEditar}
                  />
                </div>

                {/* Role */}
                <Input
                  as="select"
                  {...register('role')}
                  leftIcon={<ShieldCheck size={18} />}
                >
                  <option value="aluno">Aluno</option>
                  <option value="admin">Administrador</option>
                </Input>

                {/* Plano */}
                <Input
                  as="select"
                  {...register('plano_id')}
                  leftIcon={<Package size={18} />}
                  disabled={roleAtual !== 'aluno'}
                >
                  <option value="">Vincular Plano...</option>
                  {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </Input>

                {/* Data do 1º Pagamento */}
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

                {/* Datas do contrato + seleção de modalidades */}
                {planoSelecionado && roleAtual === 'aluno' && (
                  <>
                    {/* Início do contrato */}
                    <div className="animate-in fade-in space-y-1">
                      <Label>Início do Contrato</Label>
                      <Input {...register('data_inicio_plano')} type="date" />
                    </div>

                    {/* Fim calculado */}
                    <div className="animate-in fade-in space-y-1">
                      <Label className="text-primary flex items-center gap-1">
                        Fim (Calculado) <RefreshCw size={10} />
                      </Label>
                      <Input
                        {...register('data_fim_plano')}
                        type="date"
                        className="bg-primary-soft text-foreground font-bold"
                      />
                    </div>

                    {/* Regras do plano + seleção de slots */}
                    <div className="md:col-span-2 mt-4 animate-in slide-in-from-top-4 space-y-6">

                      {/* Resumo das regras */}
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
                                    isFull
                                      ? 'bg-info text-info-foreground border-info'
                                      : 'bg-card text-info border-info/30'
                                  }`}
                                >
                                  {limiteText} na Área: {r.modalidade}{isFull && <Check size={14} className="inline ml-1" />}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground font-medium">
                            Este plano não possui regras cadastradas. O aluno não poderá agendar aulas.
                          </p>
                        )}
                      </Surface>

                      {/* Seleção de modalidades agrupadas por área */}
                      <div className="space-y-6">
                        {Object.entries(modalidadesAgrupadas).map(([areaNome, modsArea]) => {
                          const regra = getRegraDaArea(areaNome);
                          const isAreaBloqueada = !regra;

                          return (
                            <div
                              key={areaNome}
                              className={`p-5 rounded-3xl border-2 transition-opacity ${
                                isAreaBloqueada
                                  ? 'bg-muted border-dashed border-border opacity-60'
                                  : 'bg-card border-border'
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
                  </>
                )}
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              fullWidth
              loading={isSubmitting}
              className="mt-8"
            >
              {!isSubmitting && (alunoParaEditar ? 'Salvar Alterações' : 'Concluir Cadastro')}
            </Button>
          </form>
        )}

        {/* ══════════════════════════ ABA: AGENDA ══════════════════════════ */}
        {abaAtiva === 'agenda' && (
          <div className="space-y-6 animate-in fade-in">

            {/* Warning box */}
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
                    Nenhuma modalidade configurada no perfil deste aluno ainda.
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
                                  isMatriculado
                                    ? 'border-success/30 bg-success-soft/30'
                                    : 'border-border bg-card hover:border-subtle'
                                }`}
                              >
                                <div>
                                  <p className="font-black text-foreground">{aula.dia_semana}</p>
                                  <p className="text-sm font-medium text-muted-foreground">
                                    {aula.horario.slice(0, 5)} - {aula.atividade}
                                  </p>
                                </div>
                                <button
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
          </div>
        )}
      </Surface>

      {/* Modal: Cadastro criado */}
      <Modal
        aberto={modalOpen}
        fechar={() => { setModalOpen(false); navigate('/alunos'); }}
        title="Cadastro Realizado!"
        size="sm"
      >
        <p className="text-muted-foreground text-sm mb-6">
          Copie e envie as instruções de acesso para <strong className="text-foreground">{dadosCriados?.nome}</strong>.
        </p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          leftIcon={copiado ? <Check size={20} /> : <Copy size={20} />}
          onClick={copiarInstrucoes}
        >
          {copiado ? 'Copiado!' : 'Copiar Instruções'}
        </Button>
      </Modal>
    </div>
  );
}