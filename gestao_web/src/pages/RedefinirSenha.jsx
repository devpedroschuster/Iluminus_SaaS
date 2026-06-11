import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, RefreshCw, CheckCircle2 } from 'lucide-react';
import { rotaPorPerfil } from '../lib/navigation';
import { showToast } from '../components/shared/Toast';
import { LIMITES } from '../lib/constants';

const SENHA_MIN = LIMITES.SENHA_MIN;

function calcularForca(senha) {
  if (!senha) return 0;
  let pontos = 0;
  if (senha.length >= SENHA_MIN)   pontos++;
  if (/[A-Z]/.test(senha))        pontos++;
  if (/[0-9]/.test(senha))        pontos++;
  if (/[^A-Za-z0-9]/.test(senha)) pontos++;
  if (pontos === 0) return 0;
  if (pontos === 1) return 1;
  if (pontos <= 3)  return 2;
  return 3;
}

const FORCA_CONFIG = [
  null,
  { label: 'Fraca',  segmentos: 1, cor: 'bg-red-400',    texto: 'text-red-500'    },
  { label: 'Média',  segmentos: 2, cor: 'bg-yellow-400',  texto: 'text-yellow-600' },
  { label: 'Forte',  segmentos: 3, cor: 'bg-green-500',   texto: 'text-green-600'  },
];

function IndicadorForca({ senha }) {
  const nivel = useMemo(() => calcularForca(senha), [senha]);
  const config = FORCA_CONFIG[nivel];

  return (
    <div className="mt-2 px-1 space-y-1.5">
      <div className="flex gap-1.5">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              nivel > 0 && i <= config.segmentos ? config.cor : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      {senha.length > 0 && config && (
        <p className={`text-[10px] font-black uppercase tracking-wider ${config.texto} transition-all`}>
          Senha {config.label}
          {nivel < 3 && (
            <span className="font-medium normal-case tracking-normal text-gray-400 ml-1">
              {nivel === 1 && '— adicione letras maiúsculas e números'}
              {nivel === 2 && '— adicione um caractere especial para fortalecer'}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export default function RedefinirSenha() {
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessaoValida, setSessaoValida] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const primeiroAcesso = location.state?.primeiroAcesso ?? false;
  const nomeUsuario = location.state?.nome ?? '';

  // Valida sessão levando em conta o fluxo do link de redefinição:
  // o Supabase popula a sessão via fragmento de URL (#access_token=...) apenas
  // no evento onAuthStateChange — getSession() pode retornar null no primeiro
  // render antes desse evento chegar. Por isso, se getSession() não tiver sessão,
  // aguardamos o evento PASSWORD_RECOVERY/SIGNED_IN antes de redirecionar.
  useEffect(() => {
    let subscription = null;
    let timeoutId = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Sessão já presente (primeiro acesso vindo do Login, ou tab recarregada)
        setSessaoValida(true);
        return;
      }

      // Sem sessão imediata: aguarda o evento do link de redefinição
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          setSessaoValida(true);
          subscription?.unsubscribe();
          clearTimeout(timeoutId);
        }
      });
      subscription = data.subscription;

      // Timeout de segurança: se em 6s nenhum evento válido chegar, redireciona
      timeoutId = setTimeout(() => {
        subscription?.unsubscribe();
        showToast.error('Link expirado ou inválido. Solicite um novo.');
        navigate('/login');
      }, 6000);
    });

    return () => {
      subscription?.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [navigate]);

  async function handleUpdatePassword(e) {
    e.preventDefault();

    if (novaSenha.length < SENHA_MIN) {
      showToast.error(`A senha deve ter pelo menos ${SENHA_MIN} caracteres.`);
      return;
    }
    const temVariedade = /[A-Z]/.test(novaSenha) && /[0-9]/.test(novaSenha);
    if (!temVariedade) {
      showToast.error('Use ao menos uma letra maiúscula e um número.');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      showToast.error('As senhas não coincidem.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();
      let rotaDestino = rotaPorPerfil(null);

      if (user) {
        const { data: alunoData } = await supabase
          .from('alunos')
          .select('role')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (alunoData) {
          await supabase
            .from('alunos')
            .update({ primeiro_acesso: false })
            .eq('auth_id', user.id);
          rotaDestino = rotaPorPerfil(alunoData.role);
        } else {
          const { data: profData } = await supabase
            .from('professores')
            .select('id')
            .eq('auth_id', user.id)
            .maybeSingle();

          if (profData) {
            await supabase
              .from('professores')
              .update({ primeiro_acesso: false })
              .eq('auth_id', user.id);
            rotaDestino = rotaPorPerfil('professor');
          }
        }
      }

      showToast.success('Senha definida com sucesso!');
      setTimeout(() => navigate(rotaDestino), 1000);

    } catch (error) {
      showToast.error('Erro ao atualizar: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  // Não renderiza nada enquanto valida sessão (evita flash do form e redirect prematuro)
  if (!sessaoValida) return null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl p-10 border border-orange-50 animate-in slide-in-from-bottom-4 duration-500">
        <div className="text-center mb-8">
          <div className="bg-green-50 w-20 h-20 rounded-[30px] flex items-center justify-center mx-auto mb-6">
            <Lock className="text-green-600" size={32} />
          </div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">
            {primeiroAcesso ? 'Bem-vindo!' : 'Nova Senha'}
          </h1>
          <p className="text-gray-400 font-medium mt-2">
            {primeiroAcesso
              ? `Olá${nomeUsuario ? `, ${nomeUsuario}` : ''}! Para continuar, crie sua senha pessoal de acesso.`
              : 'Crie uma senha segura para seu acesso pessoal.'}
          </p>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-5">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-4">Senha</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              placeholder={`Mínimo ${SENHA_MIN} caracteres`}
              className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-green-100 transition-all font-bold text-gray-700"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
            <IndicadorForca senha={novaSenha} />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-4">Confirmar Senha</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              placeholder="Repita a senha"
              className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-green-100 transition-all font-bold text-gray-700"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
            />
          </div>

          <button
            disabled={loading}
            className="w-full bg-gray-800 text-white py-5 rounded-[22px] font-black text-lg shadow-lg hover:bg-gray-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4"
          >
            {loading ? <RefreshCw className="animate-spin" size={24} /> : <><CheckCircle2 size={20} /> Salvar e Acessar</>}
          </button>
        </form>
      </div>
    </div>
  );
}