import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { ArrowLeft, User, Mail, ShieldCheck, Package, RefreshCw, Copy, Check, CreditCard, Calendar, Phone, MapPin, Home, CheckCircle2, CalendarDays, AlertTriangle, Trash2, Plus, Info, Lock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { alunosService } from '../services/alunosService';
import { alunoSchema } from '../lib/validation';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/shared/Toast';
import Modal from '../components/shared/Modal';

export default function NovoAluno() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  const alunoParaEditar = location.state?.alunoParaEditar;

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

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: yupResolver(alunoSchema),
    defaultValues: { role: 'aluno' }
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

    if (alunoParaEditar) {
      reset({
        nome_completo: alunoParaEditar.nome_completo || '',
        email: alunoParaEditar.email || '',
        role: alunoParaEditar.role || 'aluno',
        plano_id: alunoParaEditar.planos?.id || alunoParaEditar.plano_id || '',
        cpf: alunoParaEditar.cpf || '',
        data_nascimento: alunoParaEditar.data_nascimento || '',
        telefone: alunoParaEditar.telefone || '',
        data_inicio_plano: alunoParaEditar.data_inicio_plano || '',
        data_fim_plano: alunoParaEditar.data_fim_plano || '', 
        cep: alunoParaEditar.cep || '',
        rua: alunoParaEditar.rua || '',
        numero: alunoParaEditar.numero || '',
        bairro: alunoParaEditar.bairro || '',
      });
      setModalidadesSelecionadas(alunoParaEditar.modalidades_selecionadas || []);
    }
  }, [alunoParaEditar, reset]);

  useEffect(() => {
    if (abaAtiva === 'agenda' && alunoParaEditar) {
      carregarAgendaFixa();
    }
  }, [abaAtiva, alunoParaEditar]);

  async function carregarAgendaFixa() {
    setLoadingAgenda(true);
    try {
      const { data: aulas } = await supabase.from('agenda').select('*, modalidades(id, nome)').eq('eh_recorrente', true);
      const diasOrdem = { 'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2, 'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6 };
      
      const aulasOrdenadas = (aulas || []).sort((a, b) => {
        if (diasOrdem[a.dia_semana] !== diasOrdem[b.dia_semana]) return diasOrdem[a.dia_semana] - diasOrdem[b.dia_semana];
        return a.horario.localeCompare(b.horario);
      });

      setAulasGrade(aulasOrdenadas);

      const { data: matriculas } = await supabase.from('agenda_fixa').select('aula_id').eq('aluno_id', alunoParaEditar.id);
      setMatriculasAluno(matriculas?.map(m => m.aula_id) || []);
    } catch (error) {
      showToast.error("Erro ao carregar grade fixa.");
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

  const getUsoPorArea = (areaNome) => {
    return modalidadesSelecionadas.filter(id => {
      const mod = modalidades.find(m => m.id === id);
      return mod?.area === areaNome;
    }).length;
  };

  const getRegraDaArea = (areaNome) => {
    return regrasPlano.find(r => r.modalidade === areaNome);
  };

  const podeAdicionarMod = (modArea) => {
    const regra = getRegraDaArea(modArea);
    if (!regra) return false;
    if (regra.limite === 999) return true;
    
    const usosAtuais = getUsoPorArea(modArea);
    return usosAtuais < regra.limite;
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
    if(!acc[area]) acc[area] = [];
    acc[area].push(mod);
    return acc;
  }, {});

  const countUsoModNaGrade = (modId) => {
    return matriculasAluno.filter(aulaId => {
       const aula = aulasGrade.find(a => a.id === aulaId);
       return aula?.modalidades?.id === modId;
    }).length;
  };

  async function toggleMatriculaFixa(aula) {
    const isMatriculado = matriculasAluno.includes(aula.id);
    const modId = aula.modalidades?.id;
    const modNome = aula.modalidades?.nome;
    
    if (!isMatriculado) {
        const limiteSelecionado = getCountModEspecifca(modId);
        const usado = countUsoModNaGrade(modId);

        if (usado >= limiteSelecionado) {
            const ok = window.confirm(`ATENÇÃO: Você selecionou apenas ${limiteSelecionado}x de ${modNome} no perfil do aluno.\n\nDeseja abrir uma exceção e matricular na ${usado + 1}ª turma?`);
            if (!ok) return;
        }

        try {
            const { error } = await supabase.from('agenda_fixa').insert({ aluno_id: alunoParaEditar.id, aula_id: aula.id });
            if (error) throw error;
            showToast.success("Aluno matriculado na turma!");
            carregarAgendaFixa();
        } catch (err) {
            showToast.error("Erro ao matricular na turma.");
        }
    } else {
        if (!window.confirm(`Deseja remover o aluno definitivamente da turma de ${aula.dia_semana} às ${aula.horario}?`)) return;
        try {
            const { error } = await supabase.from('agenda_fixa').delete().match({ aluno_id: alunoParaEditar.id, aula_id: aula.id });
            if (error) throw error;
            showToast.success("Aluno removido da turma.");
            carregarAgendaFixa();
        } catch (err) {
            showToast.error("Erro ao remover da turma.");
        }
    }
  }

  async function onSubmit(data) {
    try {
      const payloadBase = {
        plano_id: data.role === 'aluno' ? data.plano_id : null,
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

      if (alunoParaEditar) {
        await alunosService.atualizar(alunoParaEditar.id, { ...payloadBase, nome_completo: data.nome_completo });
        showToast.success("Cadastro atualizado com sucesso!");
        await queryClient.invalidateQueries({ queryKey: ['alunos'] });
        navigate('/alunos');
      } else {
        const { data: funcData, error: funcError } = await supabase.functions.invoke('criar_usuario', {
          body: { email: data.email, nome: data.nome_completo, role: data.role || 'aluno' }
        });

        if (funcError) throw new Error("Falha na comunicação com o servidor seguro.");
        
        if (funcData?.error) {
           throw new Error(funcData.error === 'User already registered' 
             ? 'Este e-mail já possui um acesso no sistema.' 
             : funcData.error);
        }
        
        await supabase.from(data.role === 'professor' ? 'professores' : 'alunos')
           .update(payloadBase)
           .eq('auth_id', funcData.user.id);
        
        await queryClient.invalidateQueries({ queryKey: ['alunos', 'professores'] });
        setDadosCriados({ nome: data.nome_completo, email: data.email });
        setModalOpen(true);
      }
    } catch (error) {
       showToast.error(error.message || "Erro ao processar a solicitação.");
    }
  }

  const copiarInstrucoes = () => {
    const texto = `Olá ${dadosCriados.nome}!\nSeu cadastro no Espaço Iluminus foi criado.\n\nAcesse: ${window.location.origin}\nLogin: ${dadosCriados.email}\nSenha Provisória: Iluminus576\n\nO sistema pedirá para você criar uma nova senha no primeiro acesso.`;
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
    showToast.success("Instruções copiadas!");
  };

  const modalidadesUnicasIDs = [...new Set(modalidadesSelecionadas)];
  const listaModalidadesAgenda = modalidadesUnicasIDs.map(id => modalidades.find(m => m.id === id)).filter(Boolean);

  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => navigate('/alunos')} className="flex items-center gap-2 text-gray-400 hover:text-iluminus-terracota font-bold mb-6 transition-colors">
        <ArrowLeft size={20} /> Voltar para lista
      </button>

      <div className="bg-white rounded-[24px] md:rounded-[40px] shadow-sm border border-gray-100 p-6 md:p-10 w-full">
        <h1 className="text-2xl md:text-3xl font-black text-gray-800 mb-6">
          {alunoParaEditar ? "Perfil do Membro" : "Novo Cadastro"}
        </h1>

        <div className="flex gap-6 border-b border-gray-100 mb-8 overflow-x-auto custom-scrollbar">
          <button onClick={() => setAbaAtiva('dados')} className={`pb-4 font-black uppercase tracking-wider text-sm transition-all border-b-2 whitespace-nowrap ${abaAtiva === 'dados' ? 'border-iluminus-terracota text-iluminus-terracota' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            Dados Cadastrais
          </button>
          <button 
            onClick={() => setAbaAtiva('agenda')} 
            disabled={!alunoParaEditar} 
            className={`pb-4 font-black uppercase tracking-wider text-sm transition-all border-b-2 flex items-center gap-2 whitespace-nowrap ${abaAtiva === 'agenda' ? 'border-iluminus-terracota text-iluminus-terracota' : 'border-transparent text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed'}`}
          >
            <CalendarDays size={18} /> Agenda Fixa (Turmas)
          </button>
        </div>
        
        {abaAtiva === 'dados' && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 animate-in fade-in">
            {/* INFORMAÇÕES PESSOAIS */}
            <div className="space-y-4">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={16} /> Informações Pessoais</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative md:col-span-2">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('nome_completo')} placeholder="Nome Completo *" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
                <div className="relative">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('cpf')} placeholder="CPF (Opcional)" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('data_nascimento')} type="date" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-500" />
                </div>
                <div className="relative md:col-span-2">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('telefone')} placeholder="Telefone / WhatsApp" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
              </div>
            </div>

            {/* ENDEREÇO */}
            <div className="space-y-4 pt-4 border-t border-gray-50">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><MapPin size={16} /> Endereço Residencial</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('cep')} onBlur={(e) => buscarCep(e.target.value)} placeholder="CEP" maxLength={9} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
                <div className="relative md:col-span-2">
                  <Home className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('rua')} placeholder="Rua / Logradouro" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
                <div className="relative">
                  <input id="input-numero" {...register('numero')} placeholder="Número" className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
                <div className="relative md:col-span-2">
                  <input {...register('bairro')} placeholder="Bairro" className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                </div>
              </div>
            </div>

            {/* PLANO E REGRAS */}
            <div className="space-y-4 pt-4 border-t border-gray-50">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><ShieldCheck size={16} /> Acesso e Plano</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative md:col-span-2">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('email')} type="email" placeholder="E-mail de acesso *" disabled={!!alunoParaEditar} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>
                <div className="relative">
                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                    <select {...register('role')} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none cursor-pointer">
                      <option value="aluno">Aluno</option>
                      <option value="admin">Administrador</option>
                    </select>
                </div>
                <div className="relative">
                    <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                    <select {...register('plano_id')} disabled={roleAtual !== 'aluno'} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none cursor-pointer">
                      <option value="">Vincular Plano...</option>
                      {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                </div>

                {planoSelecionado && roleAtual === 'aluno' && (
                  <>
                    <div className="relative animate-in fade-in">
                      <label className="text-[10px] font-black text-gray-400 uppercase absolute -top-2 left-4 bg-white px-1">Início do Contrato</label>
                      <input {...register('data_inicio_plano')} type="date" className="w-full px-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600" />
                    </div>
                    
                    <div className="relative animate-in fade-in">
                      <label className="text-[10px] font-black text-orange-400 uppercase absolute -top-2 left-4 bg-white px-1 flex items-center gap-1">Fim (Calculado) <RefreshCw size={10}/></label>
                      <input {...register('data_fim_plano')} type="date" className="w-full px-4 py-4 bg-orange-50 rounded-2xl outline-none font-bold text-orange-800" />
                    </div>

                    {/* SELEÇÃO DE SLOTS */}
                    <div className="md:col-span-2 mt-4 animate-in slide-in-from-top-4">
                      
                      <div className="bg-blue-50 border border-blue-100 p-6 rounded-3xl mb-6">
                        <div className="flex items-center gap-2 mb-3">
                           <Info className="text-blue-500" size={20} />
                           <h4 className="font-black text-blue-900 text-lg">Regras do Plano: {planoSelecionadoObj?.nome}</h4>
                        </div>
                        
                        {regrasPlano.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {regrasPlano.map((r, i) => {
                              const usoAtual = getUsoPorArea(r.modalidade);
                              const limiteText = r.limite === 999 ? 'Ilimitado' : `${r.limite}x`;
                              const isFull = r.limite !== 999 && usoAtual >= r.limite;

                              return (
                                <span key={i} className={`border px-4 py-2 rounded-xl font-bold text-sm transition-colors ${isFull ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-blue-700 border-blue-200'}`}>
                                  {limiteText} na Área: {r.modalidade} {isFull && <Check size={14} className="inline ml-1" />}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-blue-800 font-medium">Este plano não possui regras cadastradas. O aluno não poderá agendar aulas.</p>
                        )}
                      </div>

                      {/* RENDEREZIÇÃO AGRUPADA POR ÁREA */}
                      <div className="space-y-6">
                        {Object.entries(modalidadesAgrupadas).map(([areaNome, modsArea]) => {
                          const regra = getRegraDaArea(areaNome);
                          const isAreaBloqueada = !regra;
                          
                          return (
                            <div key={areaNome} className={`p-5 rounded-3xl border-2 ${isAreaBloqueada ? 'bg-gray-50 border-dashed border-gray-200 opacity-60' : 'bg-white border-gray-100'}`}>
                              <div className="flex items-center justify-between mb-4">
                                 <h4 className="font-black text-gray-700 uppercase tracking-widest text-xs flex items-center gap-2">
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
                                  const count = getCountModEspecifca(mod.id);
                                  const isAtivo = count > 0;
                                  const allowAdd = podeAdicionarMod(areaNome);

                                  return (
                                    <div key={mod.id} className={`flex items-center justify-between p-3 rounded-xl transition-all ${isAreaBloqueada ? 'bg-gray-100' : isAtivo ? 'bg-orange-50/50 border border-orange-100' : 'bg-gray-50 border border-transparent'}`}>
                                      <span className={`text-sm font-bold ${isAtivo ? 'text-orange-900' : 'text-gray-500'}`}>{mod.nome}</span>
                                      
                                      <div className="flex items-center gap-2">
                                        <button 
                                          type="button" 
                                          onClick={() => removeModalidade(mod.id)} 
                                          disabled={!isAtivo} 
                                          className="w-7 h-7 flex flex-col items-center justify-center rounded-lg bg-white shadow-sm text-gray-500 font-black hover:bg-red-50 hover:text-red-500 disabled:opacity-30 disabled:shadow-none transition-colors"
                                        >
                                          -
                                        </button>
                                        
                                        <span className={`font-black w-4 text-center ${isAtivo ? 'text-iluminus-terracota' : 'text-gray-300'}`}>
                                          {count}x
                                        </span>
                                        
                                        <button 
                                          type="button" 
                                          onClick={() => addModalidade(mod.id)} 
                                          disabled={!allowAdd || isAreaBloqueada}
                                          className={`w-7 h-7 flex flex-col items-center justify-center rounded-lg bg-white shadow-sm font-black transition-colors ${!allowAdd || isAreaBloqueada ? 'opacity-30 shadow-none text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50 hover:text-blue-700'}`}
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
            
            <button type="submit" disabled={isSubmitting} className="w-full bg-iluminus-terracota text-white py-5 rounded-[22px] font-black text-lg shadow-lg shadow-orange-100 hover:scale-[1.01] flex items-center justify-center gap-3 mt-8 transition-all">
              {isSubmitting ? <RefreshCw className="animate-spin" size={24} /> : (alunoParaEditar ? "Salvar Alterações" : "Concluir Cadastro")}
            </button>
          </form>
        )}

        {abaAtiva === 'agenda' && (
          <div className="space-y-6 animate-in fade-in">
             <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 flex flex-col md:flex-row items-start gap-4">
               <AlertTriangle className="text-orange-500 shrink-0 mt-1 hidden md:block" size={24} />
               <div>
                  <h4 className="font-black text-orange-900">Gerenciamento de Turmas Regulares</h4>
                  <p className="text-sm text-orange-800 font-medium mt-1">
                    Matricule o aluno nas turmas fixas que ele selecionou.
                  </p>
               </div>
             </div>

             {loadingAgenda ? (
               <div className="flex justify-center p-12"><RefreshCw className="animate-spin text-gray-300" size={32} /></div>
             ) : (
               <div className="space-y-8">
                 {listaModalidadesAgenda.length === 0 ? (
                    <p className="text-gray-400 text-center py-8 bg-gray-50 rounded-2xl border border-dashed border-gray-200">Nenhuma modalidade configurada no perfil deste aluno ainda.</p>
                 ) : (
                    listaModalidadesAgenda.map(modObj => {
                       const limite = getCountModEspecifca(modObj.id);
                       const usado = countUsoModNaGrade(modObj.id);
                       const isFull = usado >= limite;
                       
                       const turmasDessaMod = aulasGrade.filter(a => a.modalidades?.id === modObj.id);

                       if (turmasDessaMod.length === 0) return null;

                       return (
                         <div key={modObj.id} className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
                            <div className="bg-gray-50 border-b border-gray-100 p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                               <h3 className="font-black text-gray-800 text-lg">{modObj.nome}</h3>
                               <div className={`px-3 py-1 rounded-lg font-black text-xs uppercase tracking-wider ${isFull ? 'bg-orange-100 text-iluminus-terracota' : 'bg-green-100 text-green-700'}`}>
                                 Vagas: {usado} de {limite}
                               </div>
                            </div>
                            
                            <div className="p-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                {turmasDessaMod.map(aula => {
                                  const isMatriculado = matriculasAluno.includes(aula.id);
                                  return (
                                    <div key={aula.id} className={`p-4 rounded-2xl border-2 flex justify-between items-center transition-all ${isMatriculado ? 'border-green-200 bg-green-50/30' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                                       <div>
                                          <p className="font-black text-gray-800">{aula.dia_semana}</p>
                                          <p className="text-sm font-medium text-gray-500">{aula.horario.slice(0, 5)} - {aula.atividade}</p>
                                       </div>
                                       <button 
                                         onClick={() => toggleMatriculaFixa(aula)}
                                         className={`w-10 h-10 shrink-0 rounded-xl flex flex-col items-center justify-center transition-colors ${isMatriculado ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-gray-100 text-gray-500 hover:bg-green-500 hover:text-white'}`}
                                       >
                                         {isMatriculado ? <Trash2 size={18} /> : <Plus size={18} />}
                                       </button>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                         </div>
                       )
                    })
                 )}
               </div>
             )}
          </div>
        )}
      </div>
      
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); navigate('/alunos'); }} titulo="Cadastro Realizado!">
         <button onClick={copiarInstrucoes} className="w-full bg-gray-800 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700">
             {copiado ? <Check size={20} /> : <Copy size={20} />} Copiar
         </button>
      </Modal>
    </div>
  );
}