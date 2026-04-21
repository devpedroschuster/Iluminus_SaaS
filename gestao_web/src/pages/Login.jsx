import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, Mail, Lock, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';

// Componentes e Utils
import { showToast } from '../components/shared/Toast';
import Modal, { useModal } from '../components/shared/Modal';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingRecuperar, setLoadingRecuperar] = useState(false);
  
  const navigate = useNavigate();
  const modalRecuperar = useModal();

  // LÓGICA DE LOGIN
  async function handleLogin(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });

      if (error) throw error;

      const user = authData.user;
      const metadata = user.user_metadata || {};
      const role = metadata.role || 'aluno';

      if (role === 'aluno' || role === 'admin') {
        const { data: alunoData } = await supabase
          .from('alunos')
          .select('primeiro_acesso')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (alunoData?.primeiro_acesso) {
          const primeiroNome = (metadata.nome_completo || metadata.nome || 'Usuário').split(' ')[0];
          showToast.info(`Olá, ${primeiroNome}! Defina sua senha pessoal.`);
          navigate('/redefinir-senha'); 
          return;
        }
      }

      showToast.success("Login realizado com sucesso!");
      
      if (role === 'professor') {
        navigate('/agenda');
      } else if (role === 'admin') {
        navigate('/dashboard');
      } else {
        navigate('/area-aluno');
      }

    } catch (err) {
      if (err.message.includes("Invalid login")) {
        showToast.error("E-mail ou senha incorretos.");
      } else {
        showToast.error(err.message || "Erro ao conectar.");
      }
    } finally {
      setLoading(false);
    }
  }

  // RECUPERAR SENHA
  async function handleRecuperarSenha(emailRecuperacao) {
    if (!emailRecuperacao) return;
    setLoadingRecuperar(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailRecuperacao, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });

      if (error) throw error;

      showToast.success("Link enviado! Verifique seu e-mail.");
      modalRecuperar.fechar();
    } catch (err) {
      showToast.error("Erro ao enviar link: " + err.message);
    } finally {
      setLoadingRecuperar(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FDF8F5] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl p-10 border border-orange-50 animate-in fade-in zoom-in-95 duration-500">
        
        {/* Cabeçalho */}
        <div className="text-center mb-10">
          <div className="bg-orange-50 w-20 h-20 rounded-[30px] flex items-center justify-center mx-auto mb-6 transform rotate-3">
            <LogIn className="text-iluminus-terracota" size={32} />
          </div>
          <h1 className="text-4xl font-black text-gray-800 tracking-tight mb-2">Iluminus</h1>
          <p className="text-gray-400 font-medium">Gestão de Espaço & Movimento</p>
        </div>

        {/* Formulário */}
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-4">
            <div className="relative group">
              <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-iluminus-terracota transition-colors" size={20} />
              <input 
                type="email"
                required
                placeholder="Seu e-mail"
                className="w-full pl-14 pr-4 py-5 bg-gray-50 rounded-[22px] border-2 border-transparent outline-none focus:border-orange-100 focus:bg-white transition-all font-medium text-gray-600"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="relative group">
              <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-iluminus-terracota transition-colors" size={20} />
              <input 
                type="password"
                required
                placeholder="Sua senha"
                className="w-full pl-14 pr-4 py-5 bg-gray-50 rounded-[22px] border-2 border-transparent outline-none focus:border-orange-100 focus:bg-white transition-all font-medium text-gray-600"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-iluminus-terracota text-white py-5 rounded-[22px] font-black text-lg shadow-lg shadow-orange-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
          >
            {loading ? <RefreshCw className="animate-spin" size={24} /> : (
              <>Entrar no Sistema <ArrowRight size={20} /></>
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button 
            onClick={modalRecuperar.abrir}
            className="text-sm font-bold text-gray-400 hover:text-iluminus-terracota transition-colors"
          >
            Esqueceu sua senha?
          </button>
        </div>
      </div>

      <Modal 
        isOpen={modalRecuperar.isOpen} 
        onClose={modalRecuperar.fechar}
        titulo="Recuperar Acesso"
      >
        <RecuperarFormInterno 
          onSubmit={handleRecuperarSenha} 
          loading={loadingRecuperar} 
        />
      </Modal>
    </div>
  );
}

function RecuperarFormInterno({ onSubmit, loading }) {
  const [emailRecup, setEmailRecup] = useState('');

  return (
    <div className="space-y-6 pt-2">
      <div className="bg-orange-50 p-4 rounded-2xl flex gap-3 border border-orange-100">
        <AlertCircle className="text-iluminus-terracota shrink-0" size={20} />
        <p className="text-xs text-iluminus-terracota font-bold leading-relaxed">
          Enviaremos um link seguro para você redefinir sua senha. Verifique também a caixa de Spam.
        </p>
      </div>

      <div className="relative">
        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
        <input
          type="email"
          placeholder="Digite seu e-mail cadastrado"
          className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-orange-100 font-medium"
          value={emailRecup}
          onChange={(e) => setEmailRecup(e.target.value)}
        />
      </div>
      
      <button
        onClick={() => onSubmit(emailRecup)}
        disabled={loading || !emailRecup}
        className="w-full bg-gray-800 text-white py-4 rounded-2xl font-bold hover:bg-gray-700 transition-all disabled:opacity-50 flex justify-center"
      >
        {loading ? <RefreshCw className="animate-spin" size={20} /> : "Enviar Link de Recuperação"}
      </button>
    </div>
  );
}