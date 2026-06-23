import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { LogIn, Mail, Lock, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';

import { rotaPorPerfil } from '../lib/navigation';
import { showToast } from '../components/shared/Toast';
import Modal, { useModal } from '../components/ui/Modal';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingRecuperar, setLoadingRecuperar] = useState(false);
  const { professorInativo } = useAuth();

  const navigate = useNavigate();
  const modalRecuperar = useModal();

  // LOGIN
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

      // ── 1. Verificar primeiro_acesso em alunos ────────────────────────────
      const { data: alunoData } = await supabase
        .from('alunos')
        .select('primeiro_acesso, nome_completo, role')
        .eq('auth_id', authData.user.id)
        .maybeSingle();

      if (alunoData?.primeiro_acesso) {
        const primeiroNome = (alunoData.nome_completo || 'Usuário').split(' ')[0];
        navigate('/redefinir-senha', { state: { primeiroAcesso: true, nome: primeiroNome } });
        return;
      }

      // ── 2. Verificar primeiro_acesso em professores ───────────────────────
      if (!alunoData) {
        const { data: profData } = await supabase
          .from('professores')
          .select('primeiro_acesso, nome, id')
          .eq('auth_id', authData.user.id)
          .maybeSingle();

        if (profData?.primeiro_acesso) {
          const primeiroNome = (profData.nome || 'Professor').split(' ')[0];
          navigate('/redefinir-senha', { state: { primeiroAcesso: true, nome: primeiroNome } });
          return;
        }

        if (profData) {
          const primeiroNome = (profData.nome || '').split(' ')[0];
          showToast.success(
            primeiroNome
              ? `Bem-vindo de volta, ${primeiroNome}! 👋`
              : 'Login realizado com sucesso!'
          );
          navigate('/agenda');
          return;
        }
      }

      // Admin ou aluno com acesso normal
      if (alunoData) {
        const primeiroNome = (alunoData.nome_completo || '').split(' ')[0];
        showToast.success(
          primeiroNome
            ? `Bem-vindo de volta, ${primeiroNome}! 👋`
            : 'Login realizado com sucesso!'
        );
        navigate(rotaPorPerfil(alunoData.role === 'admin' ? 'admin' : 'aluno'));
        return;
      }

      // Fallback (sem perfil correspondente)
      showToast.success('Login realizado com sucesso!');
      navigate('/');

    } catch (err) {
      // Guard primário por código; fallback por mensagem caso a versão do SDK não exponha o código
      if (err.code === 'invalid_credentials' || err.message?.includes('Invalid login')) {
        showToast.error('E-mail ou senha não conferem. Esqueceu a senha?');
      } else if (err.code === 'email_not_confirmed') {
        showToast.error('Confirme seu e-mail antes de acessar.');
      } else if (err.message?.includes('expired') || err.message?.includes('invalid')) {
        showToast.error('Link expirado. Solicite um novo link de recuperação.');
      } else {
        showToast.error('Erro ao conectar. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  // RECUPERAR SENHA
  async function handleRecuperarSenha(emailRecuperacao) {
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRecuperacao?.trim());
    if (!emailRecuperacao || !emailValido) {
      showToast.error('Digite um e-mail válido.');
      return;
    }

    setLoadingRecuperar(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailRecuperacao.trim(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });

      if (error) throw error;

      showToast.success(`Pronto! Enviamos um link para ${emailRecuperacao.trim()}. Verifique também o spam.`);
      modalRecuperar.fechar();
    } catch (err) {
      showToast.error('Erro ao enviar link: ' + err.message);
    } finally {
      setLoadingRecuperar(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl p-10 border border-orange-50 animate-in fade-in zoom-in-95 duration-500">

        {/* Cabeçalho */}
        <div className="text-center mb-10">
          <div className="bg-orange-50 w-20 h-20 rounded-[30px] flex items-center justify-center mx-auto mb-6 transform rotate-3">
            <LogIn className="text-primary" size={32} />
          </div>
          <h1 className="text-4xl font-black text-gray-800 tracking-tight mb-2">Iluminus</h1>
          <p className="text-gray-400 font-medium">Gestão de Espaço & Movimento</p>
        </div>

        {professorInativo && (
    <div className="p-4 rounded-2xl bg-destructive-soft border border-destructive/30 text-destructive text-sm font-medium">
      Sua conta está desativada. Entre em contato com a gestão do espaço.
    </div>
  )}

        {/* Formulário */}
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-4">
            <div className="relative group">
              <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={20} />
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="Seu e-mail"
                className="w-full pl-14 pr-4 py-5 bg-gray-50 rounded-[22px] border-2 border-transparent outline-none focus:border-orange-100 focus:bg-white transition-all font-medium text-gray-600"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="relative group">
              <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={20} />
              <input
                type="password"
                required
                autoComplete="current-password"
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
            className="w-full bg-primary text-primary-foreground py-5 rounded-[22px] font-black text-lg shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
          >
            {loading ? <RefreshCw className="animate-spin" size={24} /> : (
              <>Entrar <ArrowRight size={20} /></>
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={modalRecuperar.abrir}
            className="text-sm font-bold text-gray-400 hover:text-primary transition-colors"
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
        <AlertCircle className="text-primary shrink-0" size={20} />
        <p className="text-xs text-primary font-bold leading-relaxed">
          Enviaremos um link seguro para você redefinir sua senha. Verifique também a caixa de Spam.
        </p>
      </div>

      <div className="relative">
        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Seu e-mail"
          className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-orange-100 transition-all font-medium text-gray-600"
          value={emailRecup}
          onChange={(e) => setEmailRecup(e.target.value)}
        />
      </div>

      <button
        onClick={() => onSubmit(emailRecup)}
        disabled={loading || !emailRecup}
        className="w-full bg-primary text-primary-foreground py-4 rounded-[22px] font-black shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? <RefreshCw className="animate-spin" size={20} /> : 'Enviar Link de Recuperação'}
      </button>
    </div>
  );
}