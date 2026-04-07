import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { ArrowLeft, User, Mail, ShieldCheck, Package, RefreshCw, Copy, Check, CreditCard, Calendar, Phone, MapPin, Home, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

// Serviços e Libs
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

  const [planos, setPlanos] = useState([]);
  const [modalidades, setModalidades] = useState([]);
  const [modalidadesSelecionadas, setModalidadesSelecionadas] = useState([]);
  
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
        cep: alunoParaEditar.cep || '',
        rua: alunoParaEditar.rua || '',
        numero: alunoParaEditar.numero || '',
        bairro: alunoParaEditar.bairro || '',
      });
      setModalidadesSelecionadas(alunoParaEditar.modalidades_selecionadas || []);
    }
  }, [alunoParaEditar, reset]);

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

  const toggleModalidade = (mod) => {
    setModalidadesSelecionadas(prev => 
      prev.includes(mod) 
        ? prev.filter(item => item !== mod)
        : [...prev, mod]
    );
  };

  async function onSubmit(data) {
    try {
      const payloadBase = {
        plano_id: data.role === 'aluno' ? data.plano_id : null,
        modalidades_selecionadas: data.role === 'aluno' ? modalidadesSelecionadas : [],
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
          options: {
            data: {
              role: data.role || 'aluno',
              nome_completo: data.nome_completo
            }
          }
        });

        if (authError) {
          throw new Error(authError.message === 'User already registered' 
            ? 'Este e-mail já está cadastrado no sistema.' 
            : authError.message);
        }

        const { error: updateError } = await supabase
          .from(data.role === 'professor' ? 'professores' : 'alunos')
          .update(payloadBase)
          .eq('auth_id', authData.user.id);

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

  return (
    <div className="p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => navigate('/alunos')} className="flex items-center gap-2 text-gray-400 hover:text-iluminus-terracota font-bold mb-6 transition-colors">
        <ArrowLeft size={20} /> Voltar para lista
      </button>

      <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-10">
        <h1 className="text-3xl font-black text-gray-800 mb-8 pb-4 border-b border-gray-50">
          {alunoParaEditar ? "Editar Membro" : "Novo Cadastro"}
        </h1>
        
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          
          <div className="space-y-4">
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <User size={16} /> Informações Pessoais
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative md:col-span-2">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <input {...register('nome_completo')} placeholder="Nome Completo *" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
                {errors.nome_completo && <p className="text-red-500 text-[10px] uppercase ml-4 mt-1">{errors.nome_completo.message}</p>}
              </div>

              <div className="relative">
                <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <input {...register('cpf')} placeholder="CPF *" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" />
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
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <MapPin size={16} /> Endereço Residencial
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <input 
                  {...register('cep')} 
                  onBlur={(e) => buscarCep(e.target.value)}
                  placeholder="CEP" 
                  maxLength={9}
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700" 
                />
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
            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <ShieldCheck size={16} /> Acesso e Plano
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative md:col-span-2">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <input 
                  {...register('email')} 
                  type="email" 
                  placeholder="E-mail de acesso *" 
                  disabled={!!alunoParaEditar}
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" 
                />
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
                <div className="md:col-span-2 mt-2 animate-in slide-in-from-top-4">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3 block">Modalidades do Aluno</label>
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {modalidades.map(mod => {
                        const isChecked = modalidadesSelecionadas.includes(mod);
                        return (
                          <label key={mod} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${isChecked ? 'bg-white shadow-sm border border-orange-100' : 'hover:bg-gray-100 border border-transparent'}`}>
                            <input 
                              type="checkbox" 
                              className="hidden"
                              checked={isChecked}
                              onChange={() => toggleModalidade(mod)}
                            />
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-colors ${isChecked ? 'bg-iluminus-terracota border-iluminus-terracota' : 'bg-white border-gray-300'}`}>
                              {isChecked && <CheckCircle2 className="text-white w-4 h-4" />}
                            </div>
                            <span className={`text-sm font-bold ${isChecked ? 'text-gray-800' : 'text-gray-500'}`}>
                              {mod}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2 font-medium">Marque as modalidades inclusas no pacote contratado por este aluno.</p>
                </div>
              )}
            </div>
          </div>
          
          <button type="submit" disabled={isSubmitting} className="w-full bg-iluminus-terracota text-white py-5 rounded-[22px] font-black text-lg shadow-lg shadow-orange-100 hover:scale-[1.01] flex items-center justify-center gap-3 mt-8 transition-all">
            {isSubmitting ? <RefreshCw className="animate-spin" size={24} /> : (alunoParaEditar ? "Salvar Alterações" : "Concluir Cadastro")}
          </button>
        </form>
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
               <p className="font-bold text-gray-800">Senha: <span className="font-mono text-lg ml-2 bg-white px-2 rounded border border-orange-200">{SENHA_PADRAO}</span></p>
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