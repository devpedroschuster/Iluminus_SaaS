import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { ArrowLeft, User, Mail, ShieldCheck, Package, RefreshCw, Copy, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

// Serviços e Libs
import { alunosService } from '../services/alunosService';
import { alunoSchema } from '../lib/validation';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/shared/Toast';
import Modal from '../components/shared/Modal';

export default function NovoAluno() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [planos, setPlanos] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [dadosCriados, setDadosCriados] = useState(null);

  // SENHA PADRÃO PROVISÓRIA
  const SENHA_PADRAO = "Iluminus576";

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: yupResolver(alunoSchema),
    defaultValues: { role: 'aluno' }
  });

  const roleAtual = watch('role');

  useEffect(() => {
    async function fetchPlanos() {
      const { data } = await supabase.from('planos').select('*').order('nome');
      setPlanos(data || []);
    }
    fetchPlanos();
  }, []);

  async function onSubmit(data) {
    try {
      // 1. Cria usuário no Auth com a senha padrão
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: SENHA_PADRAO,
      });

      if (authError) throw authError;

      // 2. Salva no banco marcando 'primeiro_acesso: true'
      const payload = {
        auth_id: authData.user.id,
        nome_completo: data.nome_completo,
        email: data.email,
        role: data.role,
        plano_id: data.role === 'aluno' ? data.plano_id : null,
        primeiro_acesso: true // Importante!
      };

      await alunosService.criar(payload);

      // 3. Atualiza cache e mostra modal
      await queryClient.invalidateQueries({ queryKey: ['alunos'] });
      
      setDadosCriados({ nome: data.nome_completo, email: data.email });
      setModalOpen(true);
      reset();

    } catch (error) {
       showToast.error(error.message || "Erro ao realizar cadastro.");
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
    <div className="p-8 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => navigate('/alunos')} className="flex items-center gap-2 text-gray-400 hover:text-iluminus-terracota font-bold mb-6">
        <ArrowLeft size={20} /> Voltar
      </button>

      <div className="bg-white rounded-[40px] shadow-sm border border-orange-50 p-10">
        <h1 className="text-3xl font-black text-gray-800 mb-8">Novo Cadastro</h1>
        
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Inputs (Nome, Email, Role, Plano) mantidos iguais... */}
          <div className="space-y-1">
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input {...register('nome_completo')} placeholder="Nome Completo" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-orange-100 outline-none" />
            </div>
            {errors.nome_completo && <p className="text-red-500 text-[10px] uppercase ml-4">{errors.nome_completo.message}</p>}
          </div>

          <div className="space-y-1">
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
              <input {...register('email')} type="email" placeholder="E-mail de acesso" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-orange-100 outline-none" />
            </div>
            {errors.email && <p className="text-red-500 text-[10px] uppercase ml-4">{errors.email.message}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
                <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <select {...register('role')} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none cursor-pointer">
                  <option value="aluno">Aluno</option>
                  <option value="professor">Professor</option>
                  <option value="admin">Administrador</option>
                </select>
            </div>
            <div className="relative">
                <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <select {...register('plano_id')} disabled={roleAtual !== 'aluno'} className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none disabled:opacity-50 cursor-pointer">
                  <option value="">Vincular Plano...</option>
                  {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
            </div>
          </div>
          
          <button type="submit" disabled={isSubmitting} className="w-full bg-iluminus-terracota text-white py-5 rounded-[22px] font-black text-lg shadow-lg hover:brightness-95 flex items-center justify-center gap-3 mt-4">
            {isSubmitting ? <RefreshCw className="animate-spin" size={24} /> : "Cadastrar Membro"}
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
             <p className="text-gray-600 text-sm mb-1">O aluno deve acessar com:</p>
             <p className="font-bold text-gray-800">Senha: <span className="font-mono text-lg ml-2 bg-white px-2 rounded border border-orange-200">mudar123</span></p>
             <p className="text-xs text-gray-400 mt-2">No primeiro login, o sistema pedirá para ele criar uma nova senha.</p>
           </div>

           <button onClick={copiarInstrucoes} className="w-full bg-gray-800 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700">
             {copiado ? <Check size={20} /> : <Copy size={20} />}
             {copiado ? "Copiado!" : "Copiar Instruções"}
           </button>
        </div>
      </Modal>
    </div>
  );
}