import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { buscarAcesso } from '../services/acessoService';
import { showToast } from '../components/shared/showToast';
import { AuthContext } from './AuthContext';

// ILU-99: um só estado de login para o app inteiro. Antes, cada tela que
// chamava useAuth() tinha o seu próprio estado, assinatura e consultas (8
// instâncias; a Agenda do professor carregava o perfil 4 vezes), e cada uma
// podia desconectar a sessão por conta própria.
export function AuthProvider({ children }) {
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [professorId, setProfessorId] = useState(null);
  const [nome, setNome] = useState(null);
  const [primeiroAcesso, setPrimeiroAcesso] = useState(false);
  // ILU-98: sem nenhum cadastro ativo (aluno e/ou professor inativos).
  const [contaDesativada, setContaDesativada] = useState(false);
  // ILU-39: conta órfã — sessão válida no Supabase Auth, mas sem linha
  // correspondente em `alunos` nem `professores`.
  const [perfilNaoEncontrado, setPerfilNaoEncontrado] = useState(false);
  const [loading, setLoading] = useState(true);

  const perfilJaCarregado = useRef(false);
  // FIX Issue 2: rastreia para qual auth_id o perfil foi carregado,
  // para detectar troca de usuário mesmo sem SIGNED_OUT (ex: tab recarregada).
  const perfilCarregadoParaId = useRef(null);
  // ILU-64: contador incrementado sempre que uma nova sessão começa a ser
  // processada. Um signOut() disparado em segundo plano (conta desativada ou
  // sem perfil) anota a geração vigente no momento do disparo; se o
  // SIGNED_OUT correspondente só chegar depois de uma sessão mais nova já ter
  // sido estabelecida, a geração não bate mais e o evento atrasado é ignorado
  // em vez de derrubar a sessão válida.
  const geracaoRef = useRef(0);
  const signOutEmVooRef = useRef(null);
  // Dá ao recarregarAcesso() a função de carga criada dentro do efeito.
  const carregarRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const limparPerfil = () => {
      setPerfil(null);
      setProfessorId(null);
      setNome(null);
      setPrimeiroAcesso(false);
    };

    // origem 'login': veio de um login novo (SIGNED_IN), e não de uma sessão
    // que já existia — só então mostra as boas-vindas.
    const carregarPerfilUsuario = async (session, { origem } = {}) => {
      if (cancelled) return null;

      if (!session) {
        setSessao(null);
        limparPerfil();
        setContaDesativada(false);
        setPerfilNaoEncontrado(false);
        setLoading(false);
        return null;
      }

      setSessao((prev) => (prev?.user?.id === session.user.id ? prev : session));

      // FIX Issue 2: se o perfil já foi carregado para este mesmo user.id, reutiliza.
      // Se for um user.id diferente (login de outro usuário na mesma aba),
      // força recarregar mesmo que perfilJaCarregado.current seja true.
      if (perfilJaCarregado.current && perfilCarregadoParaId.current === session.user.id) {
        setLoading(false);
        return null;
      }

      // Reset para garantir que um usuário diferente não herde o perfil do anterior.
      perfilJaCarregado.current = false;
      geracaoRef.current += 1;

      // Usa auth_id (UUID do Supabase Auth) em vez de email.
      // Isso garante que alterações de email no painel do Auth não quebrem o lookup.
      const authId = session.user.id;

      try {
        // ILU-98: os dois cadastros entram na decisão (lib/perfilAcesso.js).
        const acesso = await buscarAcesso(authId);
        if (cancelled) return null;

        perfilJaCarregado.current = true;
        perfilCarregadoParaId.current = authId;

        if (acesso.perfil) {
          setPerfil(acesso.perfil);
          setProfessorId(acesso.professorId);
          setNome(acesso.nome);
          setPrimeiroAcesso(acesso.primeiroAcesso);
          setContaDesativada(false);
          setPerfilNaoEncontrado(false); // ILU-39
          setLoading(false);
          if (origem === 'login' && !acesso.primeiroAcesso) {
            const primeiroNome = (acesso.nome || '').split(' ')[0];
            showToast.success(primeiroNome ? `Bem-vindo de volta, ${primeiroNome}! 👋` : 'Login realizado com sucesso!');
          }
          return acesso;
        }

        // Conta desativada (ILU-98/99) ou sem perfil (ILU-39). Sem isso,
        // `sessao` continuava preenchida com `perfil = null`, o que travava o
        // usuário num loop infinito entre /login e /area-aluno (o App manda
        // pra lá quando há sessão, e a rota privada manda de volta pro /login
        // por falta de perfil).
        //
        // Testado ao vivo: deixar setLoading(false) e só então aguardar o
        // signOut() reproduz exatamente esse loop — o React Router alterna
        // entre as duas rotas mais rápido do que o round-trip de rede do
        // signOut(). Por isso `sessao` é limpa no mesmo lote de estado que
        // `perfil`, antes de qualquer render acontecer, e o signOut() roda em
        // segundo plano só para invalidar o token no servidor/localStorage —
        // sem bloquear a UI nem participar da corrida.
        if (acesso.bloqueio === 'sem_perfil') console.warn('Nenhum perfil encontrado para auth_id:', authId);
        setContaDesativada(acesso.bloqueio === 'desativado');
        setPerfilNaoEncontrado(acesso.bloqueio === 'sem_perfil');
        limparPerfil();
        setSessao(null);
        setLoading(false);
        signOutEmVooRef.current = geracaoRef.current;
        supabase.auth.signOut().catch(() => {});
        return acesso;
      } catch (error) {
        console.error('Erro fatal ao carregar perfil:', error);
        if (cancelled) return null;
        perfilJaCarregado.current = true;
        perfilCarregadoParaId.current = authId;
        limparPerfil();
        return null;
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    carregarRef.current = carregarPerfilUsuario;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) carregarPerfilUsuario(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        // ILU-64: um signOut() de "kick-out" (acima) anotou a geração vigente
        // no momento do disparo. Se uma sessão mais nova já foi estabelecida
        // desde então, este SIGNED_OUT chegou atrasado e não corresponde mais
        // à sessão atual — ignora, em vez de derrubar a sessão válida como se
        // fosse um logout real.
        if (signOutEmVooRef.current !== null && geracaoRef.current !== signOutEmVooRef.current) {
          signOutEmVooRef.current = null;
          return;
        }
        signOutEmVooRef.current = null;
        perfilJaCarregado.current = false;
        perfilCarregadoParaId.current = null;
        setSessao(null);
        limparPerfil();
        // ILU-39/ILU-99: contaDesativada e perfilNaoEncontrado NÃO são
        // resetados aqui de propósito — este SIGNED_OUT é disparado pelo
        // próprio signOut() em segundo plano acima, e a mensagem só fica na
        // tela de Login se sobreviver a esse evento. Eles voltam a ser
        // limpos quando um novo login começa.
        setLoading(false);

      } else if (event === 'SIGNED_IN') {
        if (perfilJaCarregado.current && perfilCarregadoParaId.current === session?.user?.id) {
          setSessao(session);
          return;
        }

        perfilJaCarregado.current = false;
        setContaDesativada(false);
        setPerfilNaoEncontrado(false);
        setLoading(true);
        carregarPerfilUsuario(session, { origem: 'login' });

      } else {
        if (perfilJaCarregado.current && perfilCarregadoParaId.current === session?.user?.id) {
          setSessao(session);
        } else {
          carregarPerfilUsuario(session);
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Relê os cadastros da sessão atual (ex.: depois de concluir o primeiro
  // acesso) e devolve o acesso resolvido.
  const recarregarAcesso = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    perfilJaCarregado.current = false;
    return carregarRef.current ? carregarRef.current(session) : null;
  }, []);

  const valor = useMemo(() => ({
    sessao, perfil, professorId, nome, primeiroAcesso, loading,
    contaDesativada, perfilNaoEncontrado,
    // #18: só o professor tem o nome exposto na Sidebar.
    nomeUsuario: perfil === 'professor' ? nome : null,
    recarregarAcesso,
  }), [sessao, perfil, professorId, nome, primeiroAcesso, loading, contaDesativada, perfilNaoEncontrado, recarregarAcesso]);

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}
