import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Lock, Save, RefreshCw, CheckCircle2 } from 'lucide-react';
import { showToast } from '../components/shared/Toast';

export default function RedefinirSenha() {
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleUpdatePassword(e) {
    e.preventDefault();
    
    // 1. Validações Locais
    if (novaSenha.length < 6) {
      showToast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    if (novaSenha !== confirmarSenha) {
      showToast.error("As senhas não coincidem.");
      return;
    }

    setLoading(true);

    try {
      // 2. Atualiza a senha no Auth do Supabase
      const { error } = await supabase.auth.updateUser({
        password: novaSenha
      });

      if (error) throw error;

      // 3. Atualiza o status de "primeiro_acesso" no banco
      // Primeiro, pegamos o usuário atual logado
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Remove a flag para ele não cair nessa tela de novo
        await supabase
          .from('alunos')
          .update({ primeiro_acesso: false })
          .eq('auth_id', user.id);
      }

      showToast.success("Senha definida com sucesso!");
      
      // Delay pequeno para o usuário ler a mensagem antes de mudar de tela
      setTimeout(() => {
        navigate('/dashboard');
      }, 1000);
      
    } catch (error) {
      showToast.error("Erro ao atualizar: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FDF8F5] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl p-10 border border-orange-50 animate-in slide-in-from-bottom-4 duration-500">
        
        <div className="text-center mb-8">
          <div className="bg-green-50 w-20 h-20 rounded-[30px] flex items-center justify-center mx-auto mb-6">
            <Lock className="text-green-600" size={32} />
          </div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Nova Senha</h1>
          <p className="text-gray-400 font-medium mt-2">Crie uma senha segura para seu acesso pessoal.</p>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-5">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-4">Senha</label>
            <input 
              type="password"
              required
              placeholder="Mínimo 6 caracteres"
              className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-green-100 transition-all font-bold text-gray-700"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-4">Confirmar Senha</label>
            <input 
              type="password"
              required
              placeholder="Repita a senha"
              className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-green-100 transition-all font-bold text-gray-700"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
            />
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-gray-800 text-white py-5 rounded-[22px] font-black text-lg shadow-lg hover:bg-gray-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4"
          >
            {loading ? <RefreshCw className="animate-spin" size={24} /> : (
              <>Salvar e Acessar <CheckCircle2 size={20} /></>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}