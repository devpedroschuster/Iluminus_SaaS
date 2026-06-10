import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import {
  ArrowLeft, ArrowRight, User, Mail, ShieldCheck, Package,
  RefreshCw, Copy, Check, CreditCard, Calendar, Phone, MapPin,
  Home, CheckCircle2, CalendarDays, AlertTriangle, Trash2, Plus,
  Info, Lock, AlertCircle, KeyRound,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { alunosService } from '../services/alunosService';
import { alunoSchema } from '../lib/validation';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/shared/Toast';
import Modal from '../components/shared/Modal';

// CPF helpers
function formatarCPF(value) {
  const n = value.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 3) return n;
  if (n.length <= 6) return `${n.slice(0, 3)}.${n.slice(3)}`;
  if (n.length <= 9) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}`;
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
}

function validarCPF(cpf) {
  const n = cpf.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(n[i]) * (10 - i);
  let r = (soma * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(n[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(n[i]) * (11 - i);
  r = (soma * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(n[10]);
}

const STEPS = [
  { id: 1, label: 'Pessoal',   icon: User     },
  { id: 2, label: 'Contato',   icon: Phone    },
  { id: 3, label: 'Endereço',  icon: MapPin   },
  { id: 4, label: 'Plano',     icon: Package  },
];

function StepIndicator({ stepAtual }) {
  return (
    <div className="flex items-center mb-8">
      {STEPS.map((s, i) => {
        const completo = s.id < stepAtual;
        const ativo    = s.id === stepAtual;
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center font-black text-sm
                transition-all duration-300
                ${completo ? 'bg-green-500 text-white shadow-sm'
                  : ativo   ? 'bg-primary text-white shadow-lg shadow-primary/30 scale-110'
                  :           'bg-gray-100 text-gray-400'}
              `}>
                {completo ? <Check size={16} /> : <s.icon size={16} />}
              </div>
              <span className={`
                text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-colors
                ${ativo ? 'text-primary' : completo ? 'text-green-600' : 'text-gray-300'}
              `}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`
                flex-1 h-0.5 mx-2 mb-4 rounded-full transition-all duration-500
                ${s.id < stepAtual ? 'bg-green-400' : 'bg-gray-100'}
              `} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function CpfField({ cpfDisplay, cpfErro, onChange }) {
  return (
    <div>
      <div className="relative">
        <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
        <input
          value={cpfDisplay}
          onChange={onChange}
          placeholder="CPF (Opcional)"
          maxLength={14}
          className={`w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border outline-none font-medium
            text-gray-700 transition-colors focus:border-orange-200
            ${cpfErro ? 'border-red-300 bg-red-50/30' : 'border-transparent'}`}
        />
      </div>
      {cpfErro && (
        <p className="text-xs text-red-500 mt-1.5 ml-1 font-medium flex items-center gap-1">
          <AlertCircle size={12} /> {cpfErro}
        </p>
      )}
    </div>
  );
}

function CepField({ register, buscandoCep, cepErro, onBlur, className = '' }) {
  return (
    <div className={className}>
      <div className="relative">
        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
        <input
          {...register('cep')}
          onBlur={onBlur}
          placeholder="CEP"
          maxLength={9}
          className={`w-full pl-12 pr-10 py-4 bg-gray-50 rounded-2xl border outline-none font-medium
            text-gray-700 transition-colors focus:border-orange-200
            ${cepErro ? 'border-orange-300' : 'border-transparent'}`}
        />
        {buscandoCep && (
          <RefreshCw
            className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-gray-300"
            size={16}
          />
        )}
      </div>
      {cepErro && (
        <p className="text-xs text-orange-600 mt-1.5 ml-1 font-medium flex items-center gap-1">
          <AlertCircle size={12} /> {cepErro}
        </p>
      )}
    </div>
  );
}

// Main component
export default function NovoAluno() {
  const navigate     = useNavigate();
  const location     = useLocation();
  const queryClient  = useQueryClient();

  const alunoParaEditar   = location.state?.alunoParaEditar   || null;
  const leadParaConversao = location.state?.leadParaConversao || null;

  const [abaAtiva,                setAbaAtiva]                = useState('dados');
  const [planos,                  setPlanos]                  = useState([]);
  const [modalidades,             setModalidades]             = useState([]);
  const [modalidadesSelecionadas, setModalidadesSelecionadas] = useState([]);
  const [aulasGrade,              setAulasGrade]              = useState([]);
  const [matriculasAluno,         setMatriculasAluno]         = useState([]);
  const [loadingAgenda,           setLoadingAgenda]           = useState(false);
  const [modalOpen,               setModalOpen]               = useState(false);

  const [confirmModal, setConfirmModal] = useState(null);

  const [copiado,                 setCopiado]                 = useState(false);
  const [dadosCriados,            setDadosCriados]            = useState(null);
  const [buscandoCep,             setBuscandoCep]             = useState(false);
  const [dataVencimento,          setDataVencimento]          = useState(
    new Date().toISOString().split('T')[0]
  );

  const [stepAtual, setStepAtual] = useState(1);

  const [cpfDisplay, setCpfDisplay] = useState('');
  const [cpfErro,    setCpfErro]    = useState('');

  const [cepErro, setCepErro] = useState('');

  const [cadastroSalvo,  setCadastroSalvo]  = useState(false);
  const [alunoSalvoId,   setAlunoSalvoId]   = useState(null);
  const [alunoSalvoEmail,setAlunoSalvoEmail]= useState('');
  const [alunoSalvoNome, setAlunoSalvoNome] = useState('');
  const [criandoAcesso,  setCriandoAcesso]  = useState(false);
  const [erroAcesso,     setErroAcesso]     = useState('');
  const [acessoCriado,   setAcessoCriado]   = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    trigger,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(alunoSchema),
    defaultValues: { role: 'aluno' },
  });

  const roleAtual          = watch('role');
  const planoSelecionado   = watch('plano_id');
  const dataInicioPlano    = useWatch({ control, name: 'data_inicio_plano' });
  const planoSelecionadoObj = planos.find(p => String(p.id) === String(planoSelecionado));
  const regrasPlano         = planoSelecionadoObj?.regras_acesso || [];

  useEffect(() => {
    if (!alunoParaEditar && !leadParaConversao) {
      reset({ nome_completo: '', email: '', role: 'aluno' });
      setModalidadesSelecionadas([]);
      setCpfDisplay('');
      setCpfErro('');
      setCepErro('');
      setStepAtual(1);
      setCadastroSalvo(false);
    }
  }, [location.pathname, reset, alunoParaEditar, leadParaConversao]);

  useEffect(() => {
    if (!planoSelecionadoObj || !dataInicioPlano) return;
    // O browser envia YYYY-MM-DD mesmo com ano incompleto (ex: 0002, 0020, 0202).
    // Só calcula quando o ano for razoável (>= 1900) para evitar re-render
    // durante a digitação do ano, o que desfocava o campo.
    const ano = parseInt(dataInicioPlano.split('-')[0], 10);
    if (!ano || ano < 1900) return;
    const dataInicio = new Date(dataInicioPlano + 'T12:00:00');
    if (isNaN(dataInicio.getTime())) return;
    const meses   = planoSelecionadoObj.duracao_meses || 1;
    const dataFim = new Date(dataInicio);
    dataFim.setMonth(dataFim.getMonth() + meses);
    dataFim.setDate(dataFim.getDate() - 1);
    setValue('data_fim_plano', dataFim.toISOString().split('T')[0]);
  }, [planoSelecionadoObj, dataInicioPlano, setValue]);

  useEffect(() => {
    async function carregarDados() {
      const { data: planosData } = await supabase.from('planos').select('*').order('nome');
      setPlanos(planosData || []);
      const { data: modData } = await supabase
        .from('modalidades').select('id, nome, area').order('area').order('nome');
      setModalidades(modData || []);
    }
    carregarDados();

    async function carregarFichaCompleta() {
      if (alunoParaEditar?.id) {
        const { data: aluno, error } = await supabase
          .from('alunos').select('*').eq('id', alunoParaEditar.id).single();
        if (aluno && !error) {
          reset({
            nome_completo:    aluno.nome_completo    || '',
            email:            aluno.email            || '',
            role:             aluno.role             || 'aluno',
            plano_id:         aluno.plano_id         || '',
            cpf:              aluno.cpf              || '',
            data_nascimento:  aluno.data_nascimento  || '',
            telefone:         aluno.telefone         || '',
            data_inicio_plano:aluno.data_inicio_plano|| '',
            data_fim_plano:   aluno.data_fim_plano   || '',
            cep:              aluno.cep              || '',
            rua:              aluno.rua              || '',
            numero:           aluno.numero           || '',
            complemento:      aluno.complemento      || '',
            bairro:           aluno.bairro           || '',
            cidade:           aluno.cidade           || '',
            contato_emergencia: aluno.contato_emergencia || '',
          });
          if (aluno.cpf) setCpfDisplay(formatarCPF(aluno.cpf));
          setModalidadesSelecionadas(aluno.modalidades_selecionadas || []);
        }
      } else if (leadParaConversao) {
        reset({
          nome_completo: leadParaConversao.nome_visitante     || '',
          telefone:      leadParaConversao.telefone_visitante || '',
          role:          'aluno',
        });
      }
    }
    carregarFichaCompleta();
  }, [alunoParaEditar, reset]);

  useEffect(() => {
    if (abaAtiva === 'agenda' && alunoParaEditar) carregarAgendaFixa();
  }, [abaAtiva, alunoParaEditar]);

  // agenda fixa
  async function carregarAgendaFixa() {
    setLoadingAgenda(true);
    try {
      const { data: aulas } = await supabase
        .from('agenda').select('*, modalidades(id, nome)').eq('eh_recorrente', true);
      const diasOrdem = {
        'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
        'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6,
      };
      setAulasGrade(
        (aulas || []).sort((a, b) => {
          if (diasOrdem[a.dia_semana] !== diasOrdem[b.dia_semana])
            return diasOrdem[a.dia_semana] - diasOrdem[b.dia_semana];
          return a.horario.localeCompare(b.horario);
        })
      );
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
    setCepErro('');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      if (!response.ok) throw new Error('http');
      const data = await response.json();
      if (data.erro) {
        setCepErro('CEP não encontrado. Preencha o endereço manualmente.');
        return;
      }
      setValue('rua',    data.logradouro, { shouldValidate: true });
      setValue('bairro', data.bairro,     { shouldValidate: true });
      setValue('cidade', data.localidade, { shouldValidate: true });
      document.getElementById('input-numero')?.focus();
    } catch {
      setCepErro('Serviço de CEP indisponível. Preencha o endereço manualmente.');
    } finally {
      setBuscandoCep(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  const handleCpfChange = (e) => {
    const formatted = formatarCPF(e.target.value);
    setCpfDisplay(formatted);
    const nums = formatted.replace(/\D/g, '');
    setValue('cpf', nums);                          // store clean digits
    if (nums.length === 11) {
      setCpfErro(validarCPF(formatted) ? '' : 'CPF inválido. Verifique os dígitos.');
    } else {
      setCpfErro('');
    }
  };

  // ─────────────────────────────────────────────────────────
  // Fix #2 – per-step validation before advancing
  // ─────────────────────────────────────────────────────────
  const camposPorStep = { 1: ['nome_completo'], 2: ['email'], 3: [], 4: [] };

  const avancarStep = async () => {
    if (stepAtual === 1 && cpfErro) return;         // block on invalid CPF
    const campos = camposPorStep[stepAtual] || [];
    const valido = campos.length === 0 || await trigger(campos);
    if (valido) setStepAtual(s => Math.min(s + 1, 4));
  };

  // ── modalidades helpers (unchanged) ───────────────────────
  const getCountModEspecifca = (modId) =>
    modalidadesSelecionadas.filter(id => id === modId).length;
  const getUsoPorArea = (areaNome) =>
    modalidadesSelecionadas.filter(id =>
      modalidades.find(m => m.id === id)?.area === areaNome
    ).length;
  const getRegraDaArea    = (areaNome) => regrasPlano.find(r => r.modalidade === areaNome);
  const podeAdicionarMod  = (modArea) => {
    const regra = getRegraDaArea(modArea);
    if (!regra) return false;
    if (regra.limite === 999) return true;
    return getUsoPorArea(modArea) < regra.limite;
  };
  const addModalidade    = (modId) => setModalidadesSelecionadas([...modalidadesSelecionadas, modId]);
  const removeModalidade = (modId) => {
    const index = modalidadesSelecionadas.lastIndexOf(modId);
    if (index > -1) {
      const nova = [...modalidadesSelecionadas];
      nova.splice(index, 1);
      setModalidadesSelecionadas(nova);
    }
  };
  const modalidadesAgrupadas = modalidades.reduce((acc, mod) => {
    const area = mod.area || 'Outros';
    if (!acc[area]) acc[area] = [];
    acc[area].push(mod);
    return acc;
  }, {});
  const countUsoModNaGrade = (modId) =>
    matriculasAluno.filter(aulaId =>
      aulasGrade.find(a => a.id === aulaId)?.modalidades?.id === modId
    ).length;

  async function executarMatricula(aula) {
    try {
      const { error } = await supabase.from('agenda_fixa')
        .insert({ aluno_id: alunoParaEditar.id, aula_id: aula.id });
      if (error) throw error;
      showToast.success('Aluno matriculado na turma!');
      carregarAgendaFixa();
    } catch { showToast.error('Erro ao matricular na turma.'); }
  }

  async function executarRemocao(aula) {
    try {
      const { error } = await supabase.from('agenda_fixa')
        .delete().match({ aluno_id: alunoParaEditar.id, aula_id: aula.id });
      if (error) throw error;
      showToast.success('Aluno removido da turma.');
      carregarAgendaFixa();
    } catch { showToast.error('Erro ao remover da turma.'); }
  }

  function toggleMatriculaFixa(aula) {
    const isMatriculado = matriculasAluno.includes(aula.id);
    if (!isMatriculado) {
      const limiteSelecionado = getCountModEspecifca(aula.modalidades?.id);
      const usado             = countUsoModNaGrade(aula.modalidades?.id);
      if (usado >= limiteSelecionado) {
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

  const calcularDataFim = (dataVencimentoStr, mesesAdicionais) => {
    if (!dataVencimentoStr || !mesesAdicionais) return '';
    const d = new Date(dataVencimentoStr + 'T12:00:00');
    d.setDate(d.getDate() + Number(mesesAdicionais) * 30);
    return d.toISOString().split('T')[0];
  };

  // ─────────────────────────────────────────────────────────
  // Fix #4 – Phase 1: save aluno WITHOUT creating auth.
  //          Auth creation is a separate, explicit action.
  // ─────────────────────────────────────────────────────────
  async function onSubmit(data) {
    try {
      // SEC-01 — nunca aceitar role do formulário; fixar sempre como 'aluno'.
      // Promoção a admin deve ocorrer via console Supabase ou Edge Function dedicada.
      const roleSanitizado = 'aluno';
      const planoFinal = (roleSanitizado === 'aluno' && data.plano_id) ? data.plano_id : null;
      let planoInfos = null;

      const payloadBase = {
        plano_id:                  planoFinal,
        modalidades_selecionadas:  roleSanitizado === 'aluno' ? modalidadesSelecionadas : [],
        data_inicio_plano:         data.data_inicio_plano || null,
        data_fim_plano:            data.data_fim_plano    || null,
        cpf:                       data.cpf               || null,
        data_nascimento:           data.data_nascimento   || null,
        telefone:                  data.telefone          || null,
        cep:                       data.cep               || null,
        rua:                       data.rua               || null,
        numero:                    data.numero            || null,
        complemento:               data.complemento       || null,
        bairro:                    data.bairro            || null,
        cidade:                    data.cidade            || null,
        contato_emergencia:        data.contato_emergencia|| null,
      };

      if (planoFinal) {
        planoInfos = planos.find(p => String(p.id) === String(planoFinal));
        if (planoInfos) {
          payloadBase.data_inicio_plano = new Date().toISOString().split('T')[0];
          payloadBase.data_fim_plano    = calcularDataFim(dataVencimento, planoInfos.duracao_meses || 1);
        }
      }

      // EDIT MODE – unchanged behaviour
      if (alunoParaEditar) {
        await alunosService.atualizar(alunoParaEditar.id, {
          ...payloadBase, nome_completo: data.nome_completo,
        });
        showToast.success('Cadastro atualizado com sucesso!');
        await queryClient.invalidateQueries({ queryKey: ['alunos'] });
        navigate('/alunos');
        return;
      }

      // CREATE MODE
      const { data: profExistente } = await supabase
        .from('professores').select('auth_id').eq('email', data.email.trim()).maybeSingle();

      let novoAlunoId = null;

      if (profExistente) {
        // Existing professor → link immediately (no new auth needed)
        const { data: alunoInserido, error } = await supabase
          .from('alunos')
          .insert([{
            ...payloadBase,
            auth_id:      profExistente.auth_id,
            nome_completo:data.nome_completo,
            email:        data.email.trim(),
          }])
          .select('id').single();
        if (error) throw new Error('Erro ao criar vínculo de aluno.');
        novoAlunoId = alunoInserido.id;
        showToast.success('Perfil vinculado ao professor com sucesso!');
      } else {
        // New student – persist the record WITHOUT auth (auth_id intentionally null).
        // The admin will create the app login in Phase 2 below.
        const { data: alunoInserido, error } = await supabase
          .from('alunos')
          .insert([{
            ...payloadBase,
            nome_completo: data.nome_completo,
            email:         data.email.trim(),
          }])
          .select('id').single();
        if (error) throw new Error('Erro ao salvar cadastro do aluno.');
        novoAlunoId = alunoInserido.id;
      }

      // Financial records
      if (novoAlunoId && planoFinal && planoInfos) {
        const { error: errHist } = await supabase.from('historico_planos').insert([{
          aluno_id:    novoAlunoId,
          plano_id:    planoFinal,
          data_inicio: payloadBase.data_inicio_plano,
          data_fim:    payloadBase.data_fim_plano,
          status:      'ativo',
          valor_pago:  planoInfos.preco || 0,
        }]);
        if (errHist) console.error('Erro no histórico:', errHist);

        const { error: errMensalidade } = await supabase.from('mensalidades').insert([{
          aluno_id:        novoAlunoId,
          plano_id:        planoFinal,
          data_vencimento: dataVencimento,
          status:          'pendente',
        }]);
        if (errMensalidade) console.error('Erro na mensalidade:', errMensalidade);
      }

      // Lead conversion
      if (leadParaConversao?.id) {
        const payload = { status_conversao: 'convertido' };
        if (novoAlunoId) payload.aluno_id = novoAlunoId;
        await supabase.from('presencas').update(payload).eq('id', leadParaConversao.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['alunos', 'professores', 'presencas'] });

      if (profExistente) {
        navigate('/alunos');
      } else {
        // Advance to Phase 2 – let admin decide whether to create login now or later
        setAlunoSalvoId(novoAlunoId);
        setAlunoSalvoEmail(data.email.trim());
        setAlunoSalvoNome(data.nome_completo);
        setCadastroSalvo(true);
      }
    } catch (error) {
      showToast.error(error.message || 'Erro ao processar a solicitação.');
    }
  }

   async function criarAcesso() {
    setCriandoAcesso(true);
    setErroAcesso('');
    try {
      const { data: funcData, error: funcError } = await supabase.functions.invoke(
        'criar_usuario',
        { body: { email: alunoSalvoEmail, nome: alunoSalvoNome, role: 'aluno' } }
      );
      if (funcError) throw new Error('Falha na comunicação com o servidor seguro.');
      if (funcData?.error) throw new Error(
        funcData.error === 'User already registered'
          ? 'Este e-mail já possui um acesso.'
          : funcData.error
      );
      const { error: linkError } = await supabase
        .from('alunos').update({ auth_id: funcData.user.id }).eq('id', alunoSalvoId);
      if (linkError) throw new Error('Acesso criado, mas falhou ao vincular ao cadastro. Anote o auth_id e contacte o suporte.');

      setAcessoCriado(true);
      setDadosCriados({ nome: alunoSalvoNome, email: alunoSalvoEmail });
      setModalOpen(true);
    } catch (err) {
      setErroAcesso(err.message || 'Falha ao criar acesso. Tente novamente.');
    } finally {
      setCriandoAcesso(false);
    }
  }

  const copiarInstrucoes = () => {
    const texto =
      `Olá ${dadosCriados.nome}!\nSeu cadastro no Espaço Iluminus foi criado.\n\n` +
      `Acesse: ${window.location.origin}\nLogin: ${dadosCriados.email}\n` +
      `Senha Provisória: Iluminus576\n\nO sistema pedirá para você criar uma nova senha no primeiro acesso.`;
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
    showToast.success('Instruções copiadas!');
  };

  const modalidadesUnicasIDs   = [...new Set(modalidadesSelecionadas)];
  const listaModalidadesAgenda = modalidadesUnicasIDs
    .map(id => modalidades.find(m => m.id === id)).filter(Boolean);

  // Shared sub-renderers
  function PlanoSlots() {
    return (
      <>
        {planoSelecionado && (
          <div className="md:col-span-2 bg-blue-50 p-4 rounded-xl border border-blue-100">
            <label className="block text-sm font-bold text-blue-800 mb-2">
              Data do 1º Pagamento
            </label>
            <input
              type="date"
              value={dataVencimento}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setDataVencimento(e.target.value)}
              className="w-full bg-white border-none rounded-xl px-4 py-3 font-bold text-gray-700
                focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
            <p className="text-[11px] text-blue-600 mt-2 font-medium">
              O plano terá validade contando a partir desta data de pagamento.
            </p>
          </div>
        )}

        {planoSelecionado && roleAtual === 'aluno' && (
          <>
            <div className="relative animate-in fade-in">
              <label className="text-[10px] font-black text-gray-400 uppercase absolute -top-2
                left-4 bg-white px-1">
                Início do Contrato
              </label>
              <input
                {...register('data_inicio_plano')}
                type="date"
                className="w-full px-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600"
              />
            </div>
            <div className="relative animate-in fade-in">
              <label className="text-[10px] font-black text-orange-400 uppercase absolute -top-2
                left-4 bg-white px-1 flex items-center gap-1">
                Fim (Calculado) <RefreshCw size={10} />
              </label>
              <input
                {...register('data_fim_plano')}
                type="date"
                className="w-full px-4 py-4 bg-orange-50 rounded-2xl outline-none font-bold text-orange-800"
              />
            </div>

            {/* Slot selection */}
            <div className="md:col-span-2 mt-4 animate-in slide-in-from-top-4">
              <div className="bg-blue-50 border border-blue-100 p-6 rounded-3xl mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="text-blue-500" size={20} />
                  <h4 className="font-black text-blue-900 text-lg">
                    Regras do Plano: {planoSelecionadoObj?.nome}
                  </h4>
                </div>
                {regrasPlano.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {regrasPlano.map((r, i) => {
                      const usoAtual   = getUsoPorArea(r.modalidade);
                      const limiteText = r.limite === 999 ? 'Ilimitado' : `${r.limite}x`;
                      const isFull     = r.limite !== 999 && usoAtual >= r.limite;
                      return (
                        <span key={i} className={`border px-4 py-2 rounded-xl font-bold text-sm
                          transition-colors
                          ${isFull
                            ? 'bg-blue-600 text-white border-blue-700'
                            : 'bg-white text-blue-700 border-blue-200'}`}>
                          {limiteText} na Área: {r.modalidade}
                          {isFull && <Check size={14} className="inline ml-1" />}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-blue-800 font-medium">
                    Este plano não possui regras cadastradas. O aluno não poderá agendar aulas.
                  </p>
                )}
              </div>

              <div className="space-y-6">
                {Object.entries(modalidadesAgrupadas).map(([areaNome, modsArea]) => {
                  const regra          = getRegraDaArea(areaNome);
                  const isAreaBloqueada= !regra;
                  return (
                    <div key={areaNome} className={`p-5 rounded-3xl border-2
                      ${isAreaBloqueada
                        ? 'bg-gray-50 border-dashed border-gray-200 opacity-60'
                        : 'bg-white border-gray-100'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-black text-gray-700 uppercase tracking-widest text-xs
                          flex items-center gap-2">
                          Área: {areaNome}
                          {isAreaBloqueada && <Lock size={14} className="text-gray-400" />}
                        </h4>
                        {!isAreaBloqueada && regra.limite !== 999 && (
                          <span className="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-md">
                            Usado: {getUsoPorArea(areaNome)} / {regra.limite}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {modsArea.map(mod => {
                          const count    = getCountModEspecifca(mod.id);
                          const isAtivo  = count > 0;
                          const allowAdd = podeAdicionarMod(areaNome);
                          return (
                            <div key={mod.id} className={`flex items-center justify-between p-3
                              rounded-xl transition-all
                              ${isAreaBloqueada ? 'bg-gray-100'
                                : isAtivo ? 'bg-orange-50/50 border border-orange-100'
                                :           'bg-gray-50 border border-transparent'}`}>
                              <span className={`text-sm font-bold
                                ${isAtivo ? 'text-orange-900' : 'text-gray-500'}`}>
                                {mod.nome}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => removeModalidade(mod.id)}
                                  disabled={!isAtivo}
                                  className="w-7 h-7 flex flex-col items-center justify-center
                                    rounded-lg bg-white shadow-sm text-gray-500 font-black
                                    hover:bg-red-50 hover:text-red-500
                                    disabled:opacity-30 disabled:shadow-none transition-colors"
                                >
                                  -
                                </button>
                                <span className={`font-black w-4 text-center
                                  ${isAtivo ? 'text-primary' : 'text-gray-300'}`}>
                                  {count}x
                                </span>
                                <button
                                  type="button"
                                  onClick={() => addModalidade(mod.id)}
                                  disabled={!allowAdd || isAreaBloqueada}
                                  className={`w-7 h-7 flex flex-col items-center justify-center
                                    rounded-lg bg-white shadow-sm font-black transition-colors
                                    ${!allowAdd || isAreaBloqueada
                                      ? 'opacity-30 shadow-none text-gray-400 cursor-not-allowed'
                                      : 'text-blue-600 hover:bg-blue-50 hover:text-blue-700'}`}
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
      </>
    );
  }

  // Stepper step content
  function renderStep1() {
    return (
      <div className="space-y-4 animate-in fade-in">
        <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
          flex items-center gap-2">
          <User size={16} /> Dados Pessoais
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative md:col-span-2">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('nome_completo')}
              placeholder="Nome Completo *"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
            {errors.nome_completo && (
              <p className="text-xs text-red-500 mt-1.5 ml-1 font-medium">
                {errors.nome_completo.message}
              </p>
            )}
          </div>
          <CpfField cpfDisplay={cpfDisplay} cpfErro={cpfErro} onChange={handleCpfChange} />
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('data_nascimento')}
              type="date"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-500"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderStep2() {
    return (
      <div className="space-y-4 animate-in fade-in">
        <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
          flex items-center gap-2">
          <Phone size={16} /> Contato
        </h3>
        <div className="grid grid-cols-1 gap-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('email')}
              type="email"
              placeholder="E-mail de acesso *"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
            {errors.email && (
              <p className="text-xs text-red-500 mt-1.5 ml-1 font-medium">
                {errors.email.message}
              </p>
            )}
          </div>
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('telefone')}
              placeholder="Telefone / WhatsApp"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderStep3() {
    return (
      <div className="space-y-4 animate-in fade-in">
        <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
          flex items-center gap-2">
          <MapPin size={16} /> Endereço Residencial
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CepField register={register} buscandoCep={buscandoCep} cepErro={cepErro} onBlur={e => buscarCep(e.target.value)} />
          <div className="relative md:col-span-2">
            <Home className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('rua')}
              placeholder="Rua / Logradouro"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
          <div className="relative">
            <input
              id="input-numero"
              {...register('numero')}
              placeholder="Número"
              className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
          <div className="relative md:col-span-2">
            <input
              {...register('complemento')}
              placeholder="Complemento (Apto, Bloco...)"
              className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
          <div className="relative">
            <input
              {...register('bairro')}
              placeholder="Bairro"
              className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
          <div className="relative md:col-span-2">
            <input
              {...register('cidade')}
              placeholder="Cidade"
              className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
        </div>
        <div className="pt-2">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
            flex items-center gap-2">
            <Phone size={16} /> Contato de Emergência
          </h3>
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('contato_emergencia')}
              placeholder="Nome — (51) 9 0000-0000"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderStep4() {
    return (
      <div className="space-y-4 animate-in fade-in">
        <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
          flex items-center gap-2">
          <ShieldCheck size={16} /> Acesso e Plano
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <select
              {...register('role')}
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold
                text-gray-600 appearance-none cursor-pointer"
            >
              <option value="aluno">Aluno</option>
            </select>
          </div>
          <div className="relative">
            <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <select
              {...register('plano_id')}
              disabled={roleAtual !== 'aluno'}
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold
                text-gray-600 appearance-none cursor-pointer"
            >
              <option value="">Vincular Plano...</option>
              {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <PlanoSlots />
        </div>
      </div>
    );
  }

  function renderEditForm() {
    return (
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 animate-in fade-in">
        {/* Informações Pessoais */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
            flex items-center gap-2">
            <User size={16} /> Informações Pessoais
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative md:col-span-2">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input
                {...register('nome_completo')}
                placeholder="Nome Completo *"
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
            <CpfField cpfDisplay={cpfDisplay} cpfErro={cpfErro} onChange={handleCpfChange} />
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input
                {...register('data_nascimento')}
                type="date"
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-500"
              />
            </div>
            <div className="relative md:col-span-2">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input
                {...register('telefone')}
                placeholder="Telefone / WhatsApp"
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="space-y-4 pt-4 border-t border-gray-50">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
            flex items-center gap-2">
            <MapPin size={16} /> Endereço Residencial
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CepField register={register} buscandoCep={buscandoCep} cepErro={cepErro} onBlur={e => buscarCep(e.target.value)} />
            <div className="relative md:col-span-2">
              <Home className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input
                {...register('rua')}
                placeholder="Rua / Logradouro"
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
            <div className="relative">
              <input
                id="input-numero"
                {...register('numero')}
                placeholder="Número"
                className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
            <div className="relative md:col-span-2">
              <input
                {...register('complemento')}
                placeholder="Complemento (Apto, Bloco...)"
                className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
            <div className="relative">
              <input
                {...register('bairro')}
                placeholder="Bairro"
                className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
            <div className="relative md:col-span-2">
              <input
                {...register('cidade')}
                placeholder="Cidade"
                className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700"
              />
            </div>
          </div>
          <div className="relative mt-4">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
            <input
              {...register('contato_emergencia')}
              placeholder="Contato de Emergência — Nome (51) 9 0000-0000"
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                focus:border-orange-200 outline-none font-medium text-gray-700"
            />
          </div>
        </div>

        {/* Plano e Regras */}
        <div className="space-y-4 pt-4 border-t border-gray-50">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4
            flex items-center gap-2">
            <ShieldCheck size={16} /> Acesso e Plano
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative md:col-span-2">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input
                {...register('email')}
                type="email"
                placeholder="E-mail de acesso *"
                disabled
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent
                  focus:border-orange-200 outline-none font-medium text-gray-700
                  disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div className="relative">
              <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <select
                {...register('role')}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold
                  text-gray-600 appearance-none cursor-pointer"
              >
                <option value="aluno">Aluno</option>
              </select>
            </div>
            <div className="relative">
              <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <select
                {...register('plano_id')}
                disabled={roleAtual !== 'aluno'}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold
                  text-gray-600 appearance-none cursor-pointer"
              >
                <option value="">Vincular Plano...</option>
                {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <PlanoSlots />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-primary text-white py-5 rounded-[22px] font-black text-lg shadow-lg
            shadow-primary/20 hover:scale-[1.01] flex items-center justify-center gap-3 mt-8
            transition-all"
        >
          {isSubmitting
            ? <RefreshCw className="animate-spin" size={24} />
            : 'Salvar Alterações'}
        </button>
      </form>
    );
  }

  function renderAgenda() {
    return (
      <div className="space-y-6 animate-in fade-in">
        <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100
          flex flex-col md:flex-row items-start gap-4">
          <AlertTriangle className="text-orange-500 shrink-0 mt-1 hidden md:block" size={24} />
          <div>
            <h4 className="font-black text-orange-900">Gerenciamento de Turmas Regulares</h4>
            <p className="text-sm text-orange-800 font-medium mt-1">
              Matricule o aluno nas turmas fixas que ele selecionou.
            </p>
          </div>
        </div>
        {loadingAgenda ? (
          <div className="flex justify-center p-12">
            <RefreshCw className="animate-spin text-gray-300" size={32} />
          </div>
        ) : (
          <div className="space-y-8">
            {listaModalidadesAgenda.length === 0 ? (
              <p className="text-gray-400 text-center py-8 bg-gray-50 rounded-2xl
                border border-dashed border-gray-200">
                Nenhuma modalidade configurada no perfil deste aluno ainda.
              </p>
            ) : (
              listaModalidadesAgenda.map(modObj => {
                const limite = getCountModEspecifca(modObj.id);
                const usado  = countUsoModNaGrade(modObj.id);
                const isFull = usado >= limite;
                const turmas = aulasGrade.filter(a => a.modalidades?.id === modObj.id);
                if (turmas.length === 0) return null;
                return (
                  <div key={modObj.id}
                    className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
                    <div className="bg-gray-50 border-b border-gray-100 p-4 flex flex-col
                      md:flex-row justify-between items-start md:items-center gap-2">
                      <h3 className="font-black text-gray-800 text-lg">{modObj.nome}</h3>
                      <div className={`px-3 py-1 rounded-lg font-black text-xs uppercase
                        tracking-wider
                        ${isFull ? 'bg-orange-100 text-primary' : 'bg-green-100 text-green-700'}`}>
                        Vagas: {usado} de {limite}
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {turmas.map(aula => {
                          const isMatriculado = matriculasAluno.includes(aula.id);
                          return (
                            <div key={aula.id} className={`p-4 rounded-2xl border-2 flex
                              justify-between items-center transition-all
                              ${isMatriculado
                                ? 'border-green-200 bg-green-50/30'
                                : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                              <div>
                                <p className="font-black text-gray-800">{aula.dia_semana}</p>
                                <p className="text-sm font-medium text-gray-500">
                                  {aula.horario.slice(0, 5)} - {aula.atividade}
                                </p>
                              </div>
                              <button
                                onClick={() => toggleMatriculaFixa(aula)}
                                className={`w-10 h-10 shrink-0 rounded-xl flex flex-col items-center
                                  justify-center transition-colors
                                  ${isMatriculado
                                    ? 'bg-red-50 text-red-500 hover:bg-red-100'
                                    : 'bg-gray-100 text-gray-500 hover:bg-green-500 hover:text-white'}`}
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
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={() => navigate('/alunos')}
        className="flex items-center gap-2 text-gray-400 hover:text-primary font-bold mb-6
          transition-colors"
      >
        <ArrowLeft size={20} /> Voltar para lista
      </button>

      <div className="bg-white rounded-[24px] md:rounded-[40px] shadow-sm border border-gray-100
        p-6 md:p-10 w-full">
        <h1 className="text-2xl md:text-3xl font-black text-gray-800 mb-6">
          {alunoParaEditar ? 'Perfil do Membro' : 'Novo Cadastro'}
        </h1>

        {/* EDIT MODE */}
        {alunoParaEditar && (
          <>
            <div className="flex gap-6 border-b border-gray-100 mb-8 overflow-x-auto
              custom-scrollbar">
              <button
                onClick={() => setAbaAtiva('dados')}
                className={`pb-4 font-black uppercase tracking-wider text-sm transition-all
                  border-b-2 whitespace-nowrap
                  ${abaAtiva === 'dados'
                    ? 'border-iluminus-terracota text-primary'
                    : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                Dados Cadastrais
              </button>
              <button
                onClick={() => setAbaAtiva('agenda')}
                className={`pb-4 font-black uppercase tracking-wider text-sm transition-all
                  border-b-2 flex items-center gap-2 whitespace-nowrap
                  ${abaAtiva === 'agenda'
                    ? 'border-iluminus-terracota text-primary'
                    : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <CalendarDays size={18} /> Agenda Fixa (Turmas)
              </button>
            </div>
            {abaAtiva === 'dados'   && renderEditForm()}
            {abaAtiva === 'agenda' && renderAgenda()}
          </>
        )}

        {!alunoParaEditar && !cadastroSalvo && (
          <>
            <StepIndicator stepAtual={stepAtual} />
            <form onSubmit={handleSubmit(onSubmit)} className="animate-in fade-in">
              {stepAtual === 1 && renderStep1()}
              {stepAtual === 2 && renderStep2()}
              {stepAtual === 3 && renderStep3()}
              {stepAtual === 4 && renderStep4()}

              <div className="flex gap-4 mt-8">
                {stepAtual > 1 && (
                  <button
                    type="button"
                    onClick={() => setStepAtual(s => s - 1)}
                    className="flex-1 py-4 rounded-[22px] font-black text-gray-500 bg-gray-50
                      hover:bg-gray-100 flex items-center justify-center gap-2 transition-all"
                  >
                    <ArrowLeft size={20} /> Voltar
                  </button>
                )}
                {stepAtual < 4 && (
                  <button
                    type="button"
                    onClick={avancarStep}
                    className="flex-1 bg-primary text-white py-4 rounded-[22px] font-black
                      flex items-center justify-center gap-2 hover:scale-[1.01] transition-all
                      shadow-lg shadow-primary/20"
                  >
                    Próximo <ArrowRight size={20} />
                  </button>
                )}
                {stepAtual === 4 && (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-primary text-white py-5 rounded-[22px] font-black text-lg
                      shadow-lg shadow-primary/20 hover:scale-[1.01] flex items-center
                      justify-center gap-3 transition-all"
                  >
                    {isSubmitting
                      ? <RefreshCw className="animate-spin" size={24} />
                      : 'Salvar Cadastro'}
                  </button>
                )}
              </div>
            </form>
          </>
        )}

        {!alunoParaEditar && cadastroSalvo && (
          <div className="animate-in fade-in space-y-6">
            {/* Success banner */}
            <div className="bg-green-50 border border-green-200 rounded-3xl p-6
              flex items-start gap-4">
              <CheckCircle2 className="text-green-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h3 className="font-black text-green-900 text-lg">
                  Cadastro salvo com sucesso!
                </h3>
                <p className="text-sm text-green-700 mt-1">
                  Os dados de <strong>{alunoSalvoNome}</strong> foram salvos.
                  Agora você pode criar o acesso ao app, ou fazer isso depois.
                </p>
              </div>
            </div>

            {!acessoCriado ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl
                p-8 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <KeyRound className="text-gray-400" size={24} />
                  <h3 className="font-black text-gray-800 text-lg">Criar Acesso ao App</h3>
                </div>
                <p className="text-sm text-gray-500">
                  Isso cria um login para <strong>{alunoSalvoEmail}</strong> com senha
                  provisória. O aluno será solicitado a trocar no primeiro acesso.
                </p>

                {erroAcesso && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4
                    flex items-start gap-3">
                    <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                    <div>
                      <p className="text-sm font-bold text-red-700">{erroAcesso}</p>
                      <p className="text-xs text-red-500 mt-1">
                        Você pode tentar novamente ou pular e fazer isso depois.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={criarAcesso}
                    disabled={criandoAcesso}
                    className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black
                      flex items-center justify-center gap-2 hover:bg-gray-700
                      transition-all disabled:opacity-60"
                  >
                    {criandoAcesso
                      ? <><RefreshCw className="animate-spin" size={20} /> Criando acesso...</>
                      : <><KeyRound size={20} /> {erroAcesso ? 'Tentar Novamente' : 'Criar Acesso'}</>}
                  </button>
                  <button
                    onClick={() => navigate('/alunos')}
                    className="flex-1 py-4 rounded-2xl font-black text-gray-400 bg-gray-50
                      hover:bg-gray-100 transition-all"
                  >
                    Fazer depois
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-3xl p-6 text-center">
                <CheckCircle2 className="text-blue-500 mx-auto mb-3" size={32} />
                <h3 className="font-black text-blue-900">Acesso criado!</h3>
                <p className="text-sm text-blue-700 mt-1">
                  As instruções de acesso foram geradas.
                </p>
                <button
                  onClick={() => navigate('/alunos')}
                  className="mt-4 bg-primary text-white px-8 py-3 rounded-xl font-black
                    hover:scale-105 transition-all"
                >
                  Voltar para lista
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de confirmação */}
      <Modal
        isOpen={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        titulo="Confirmação"
      >
        <p className="text-gray-700 font-medium mb-6 whitespace-pre-line leading-relaxed">
          {confirmModal?.mensagem}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setConfirmModal(null)}
            className="flex-1 py-3 rounded-2xl font-black text-gray-500 bg-gray-50 hover:bg-gray-100 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              confirmModal?.onConfirmar();
              setConfirmModal(null);
            }}
            className="flex-1 py-3 rounded-2xl font-black text-white bg-primary hover:opacity-90 transition-all shadow-lg shadow-primary/20"
          >
            Confirmar
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); navigate('/alunos'); }}
        titulo="Acesso Criado!"
      >
        <button
          onClick={copiarInstrucoes}
          className="w-full bg-gray-800 text-white py-4 rounded-2xl font-bold
            flex items-center justify-center gap-2 hover:bg-gray-700"
        >
          {copiado ? <Check size={20} /> : <Copy size={20} />} Copiar Instruções
        </button>
      </Modal>
    </div>
  );
}