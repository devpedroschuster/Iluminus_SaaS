import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { ArrowLeft, User, Mail, ShieldCheck, Package, RefreshCw, Copy, Check, CreditCard, Calendar, Phone, MapPin, Home, CheckCircle2, CalendarDays, AlertTriangle, Trash2, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { alunosService } from '../services/alunosService';
import { createClient } from '@supabase/supabase-js';
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

  const SENHA_PADRAO = "Iluminus576";

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: yupResolver(alunoSchema),
    defaultValues: { role: 'aluno' }
  });

  const roleAtual = watch('role');
  const planoSelecionado = watch('plano_id');
  const dataInicioPlano = watch('data_inicio_plano');

  const planoSelecionadoObj = planos.find(p => p.id === Number(planoSelecionado));
  const isPlanoLivre = planoSelecionadoObj?.nome?.toLowerCase().includes('livre') || planoSelecionadoObj?.nome?.toLowerCase().includes('avulso');

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

      const { data: modData } = await supabase.from('modalidades').select('nome').order('nome');
      if (modData && modData.length > 0) {
        setModalidades(modData.map(m => m.nome));
      } else {
        setModalidades(['Funcional', 'Dança Criativa', 'Free Funk', 'Ballet', 'Jazz', 'Yoga']);
      }
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
      const { data: aulas } = await supabase
        .from('agenda')
        .select('*, modalidades(nome)')
        .eq('eh_recorrente', true);
      
      const diasOrdem = { 'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2, 'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6 };
      
      const aulasOrdenadas = (aulas || []).sort((a, b) => {
        if (diasOrdem[a.dia_semana] !== diasOrdem[b.dia_semana]) {
          return diasOrdem[a.dia_semana] - diasOrdem[b.dia_semana];
        }
        return a.horario.localeCompare(b.horario);
      });

      setAulasGrade(aulasOrdenadas);

      const { data: matriculas } = await supabase
        .from('agenda_fixa')
        .select('aula_id')
        .eq('aluno_id', alunoParaEditar.id);
      
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
      } else {
        showToast.error('CEP não encontrado.');
      }
    } catch (error) {
      showToast.error('Erro ao buscar o CEP.');
    } finally {
      setBuscandoCep(false);
    }
  };

  const getCountMod = (mod) => modalidadesSelecionadas.filter(m => m === mod).length;

  const countUsoMod = (modNome) => {
    return matriculasAluno.filter(aulaId => {
       const aula = aulasGrade.find(a => a.id === aulaId);
       return aula?.modalidades?.nome === modNome;
    }).length;
  };

  const addModalidade = (mod) => setModalidadesSelecionadas([...modalidadesSelecionadas, mod]);

  const removeModalidade = (mod) => {
    const index = modalidadesSelecionadas.lastIndexOf(mod);
    if (index > -1) {
      const novaLista = [...modalidadesSelecionadas];
      novaLista.splice(index, 1);
      setModalidadesSelecionadas(novaLista);
    }
  };

  async function toggleMatriculaFixa(aula) {
    const isMatriculado = matriculasAluno.includes(aula.id);
    const modNome = aula.modalidades?.nome;
    
    if (!isMatriculado) {
        const limite = getCountMod(modNome);
        const usado = countUsoMod(modNome);

        if (!isPlanoLivre && usado >= limite) {
            const ok = window.confirm(`ATENÇÃO: O plano do aluno permite apenas ${limite}x de ${modNome} por semana.\n\nDeseja abrir uma exceção e matricular na ${usado + 1}ª aula?`);
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
        await alunosService.atualizar(alunoParaEditar.id, {
          ...payloadBase,
          nome_completo: data.nome_completo 
        });
        showToast.success("Cadastro atualizado com sucesso!");
        await queryClient.invalidateQueries({ queryKey: ['alunos'] });
        navigate('/alunos');
      } else {
        const supabaseFantasma = createClient(supabase.supabaseUrl, supabase.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });

        const { data: authData, error: authError } = await supabaseFantasma.auth.signUp({
          email: data.email,
          password: SENHA_PADRAO,
          options: { data: { role: data.role || 'aluno', nome_completo: data.nome_completo } }
        });

        if (authError) {
          throw new Error(authError.message === 'User already registered' ? 'Este e-mail já está cadastrado no sistema.' : authError.message);
        }

        const { error: updateError } = await supabase.from(data.role === 'professor' ? 'professores' : 'alunos').update(payloadBase).eq('auth_id', authData.user.id);

        if (updateError) {
          showToast.warning("Acesso criado, mas houve erro ao salvar endereço e plano. Edite depois.");
        }

        await queryClient.invalidateQueries({ queryKey: ['alunos', 'professores'] });
        setDadosCriados({ nome: data.nome_completo, email: data.email });
        setModalOpen(true);
      }
    } catch (error) {
       showToast.error(error.message || "Erro ao processar a solicitação.");
    }
  }

  const copiarInstrucoes = () => {
    const texto = `Olá ${dadosCriados.nome}!\nSeu cadastro no Espaço Iluminus foi criado.\n\nAcesse: ${window.location.origin}\nLogin: ${dadosCriados.email}\nSenha Provisória: ${SENHA_PADRAO}\n\nO sistema pedirá para você criar uma nova senha no primeiro acesso.`;
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
    showToast.success("Instruções copiadas!");
  };

  const modalidadesUnicas = [...new Set(modalidadesSelecionadas)];
  const listaModalidadesAgenda = isPlanoLivre ? modalidades : modalidadesUnicas;

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
            title={!alunoParaEditar ? "Salve o aluno primeiro" : ""}
          >
            <CalendarDays size={18} /> Agenda Fixa (Turmas)
          </button>
        </div>
        
        {abaAtiva === 'dados' && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 animate-in fade-in">
            <div className="space-y-4">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={16} /> Informações Pessoais</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative md:col-span-2">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('nome_completo')} placeholder="Nome Completo *" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                  {errors.nome_completo && <p className="text-red-500 text-[10px] uppercase ml-4 mt-1">{errors.nome_completo.message}</p>}
                </div>
                <div className="relative">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('cpf')} placeholder="CPF (Opcional)" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                  {errors.cpf && <p className="text-red-500 text-[10px] uppercase ml-4 mt-1">{errors.cpf.message}</p>}
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

            <div className="space-y-4 pt-4 border-t border-gray-50">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><MapPin size={16} /> Endereço Residencial</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('cep')} onBlur={(e) => buscarCep(e.target.value)} placeholder="CEP" maxLength={9} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                  {buscandoCep && <RefreshCw size={14} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-orange-400" />}
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

            <div className="space-y-4 pt-4 border-t border-gray-50">
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><ShieldCheck size={16} /> Acesso e Plano</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative md:col-span-2">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                  <input {...register('email')} type="email" placeholder="E-mail de acesso *" disabled={!!alunoParaEditar} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" />
                  {errors.email && <p className="text-red-500 text-[10px] uppercase ml-4 mt-1">{errors.email.message}</p>}
                  {alunoParaEditar && <p className="text-gray-400 text-[10px] uppercase ml-4 mt-1">O e-mail de acesso não pode ser alterado por aqui.</p>}
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
                    <select {...register('plano_id')} disabled={roleAtual !== 'aluno'} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none disabled:opacity-50 cursor-pointer border border-transparent focus:border-orange-200">
                      <option value="">Vincular Plano...</option>
                      {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                </div>

                {planoSelecionado && roleAtual === 'aluno' && (
                  <>
                    <div className="relative animate-in fade-in">
                      <label className="text-[10px] font-black text-gray-400 uppercase absolute -top-2 left-4 bg-white px-1">Início do Contrato</label>
                      <input {...register('data_inicio_plano')} type="date" className="w-full px-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-bold text-gray-600" />
                    </div>
                    
                    <div className="relative animate-in fade-in">
                      <label className="text-[10px] font-black text-orange-400 uppercase absolute -top-2 left-4 bg-white px-1 flex items-center gap-1">Fim (Calculado) <RefreshCw size={10}/></label>
                      <input {...register('data_fim_plano')} type="date" className="w-full px-4 py-4 bg-orange-50 rounded-2xl border border-orange-100 focus:border-orange-300 outline-none font-bold text-orange-800" />
                    </div>

                    <div className="md:col-span-2 mt-2 animate-in slide-in-from-top-4">
                      <label className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3 block">Modalidades do Aluno</label>
                      
                      {isPlanoLivre ? (
                         <div className="bg-green-50 p-6 rounded-2xl border border-green-100 flex flex-col items-center justify-center text-center mb-4">
                            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-3">
                              <CheckCircle2 size={24} />
                            </div>
                            <h4 className="font-black text-green-800">Acesso Total Liberado</h4>
                            <p className="text-sm text-green-700 mt-1 font-medium">Este é um plano livre. O aluno pode agendar qualquer aula, mas você também pode matriculá-lo na Aba de Agenda Fixa se desejar criar uma rotina.</p>
                         </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {modalidades.map(mod => {
                              const count = getCountMod(mod);
                              const isAtivo = count > 0;
                              return (
                                <div key={mod} className={`flex items-center justify-between p-3 rounded-2xl border-2 transition-all ${isAtivo ? 'bg-white border-orange-200 shadow-sm' : 'bg-gray-50 border-transparent hover:bg-gray-100'}`}>
                                  <span className={`text-sm font-bold ${isAtivo ? 'text-gray-800' : 'text-gray-400'}`}>{mod}</span>
                                  <div className="flex items-center gap-3 bg-white px-2 py-1 rounded-xl shadow-sm border border-gray-100">
                                    <button type="button" onClick={() => removeModalidade(mod)} disabled={!isAtivo} className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-50 text-gray-500 font-black hover:bg-red-50 hover:text-red-500 disabled:opacity-30 transition-colors">-</button>
                                    <span className="font-black text-iluminus-terracota w-4 text-center">{count}x</span>
                                    <button type="button" onClick={() => addModalidade(mod)} className="w-6 h-6 flex items-center justify-center rounded-md bg-orange-50 text-orange-600 font-black hover:bg-orange-100 transition-colors">+</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-2 font-medium">Use os botões + e - para definir quantas vezes na semana o aluno fará cada modalidade no combo contratado.</p>
                        </>
                      )}
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
                    Matricule o aluno em turmas específicas. {isPlanoLivre ? "Como este aluno possui um Plano Livre, ele pode ser matriculado em qualquer turma sem limite." : "O sistema exibirá as aulas que pertencem ao pacote dele."}
                  </p>
               </div>
             </div>

             {loadingAgenda ? (
               <div className="flex justify-center p-12"><RefreshCw className="animate-spin text-gray-300" size={32} /></div>
             ) : (
               <div className="space-y-8">
                 {listaModalidadesAgenda.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">Não há modalidades disponíveis no sistema.</p>
                 ) : (
                    listaModalidadesAgenda.map(modNome => {
                       const limite = getCountMod(modNome);
                       const usado = countUsoMod(modNome);
                       const isFull = !isPlanoLivre && (usado >= limite);
                       
                       const turmasDessaMod = aulasGrade.filter(a => a.modalidades?.nome === modNome);

                       if (turmasDessaMod.length === 0) return null;

                       return (
                         <div key={modNome} className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
                            <div className="bg-gray-50 border-b border-gray-100 p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                               <h3 className="font-black text-gray-800 text-lg">{modNome}</h3>
                               <div className={`px-3 py-1 rounded-lg font-black text-xs uppercase tracking-wider ${isPlanoLivre ? 'bg-blue-100 text-blue-700' : isFull ? 'bg-orange-100 text-iluminus-terracota' : 'bg-green-100 text-green-700'}`}>
                                 {isPlanoLivre ? `Matriculado em ${usado} (Ilimitado)` : `Vagas: ${usado} de ${limite}`}
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
                                         className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors ${isMatriculado ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-gray-100 text-gray-500 hover:bg-green-500 hover:text-white'}`}
                                         title={isMatriculado ? "Remover da turma" : "Matricular na turma"}
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
        <div className="space-y-4 pt-2">
           <div className="bg-green-50 p-4 rounded-2xl border border-green-100 text-center">
              <p className="text-green-800 font-bold">Membro cadastrado com sucesso!</p>
           </div>
           
           <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100">
             <p className="text-xs font-black text-orange-400 uppercase mb-2">Instruções de Acesso</p>
             <p className="text-gray-600 text-sm mb-1">O membro deve acessar com:</p>
             {dadosCriados && (
               <p className="font-bold text-gray-800 break-all">Senha: <span className="font-mono text-lg ml-2 bg-white px-2 rounded border border-orange-200">{SENHA_PADRAO}</span></p>
             )}
             <p className="text-xs text-gray-400 mt-2">No primeiro login, o sistema pedirá para criar uma nova senha.</p>
           </div>

           <button onClick={copiarInstrucoes} className="w-full bg-gray-800 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors">
             {copiado ? <Check size={20} /> : <Copy size={20} />}
             {copiado ? "Copiado!" : "Copiar Instruções"}
           </button>
        </div>
      </Modal>
    </div>
  );
}