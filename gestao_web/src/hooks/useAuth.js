import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { buscarAcesso } from '../services/acessoService';

export function useAuth() {
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [professorId, setProfessorId] = useState(null);
  const [nomeUsuario, setNomeUsuario] = useState(null); // #18 — novo estado
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
  // processada. Um signOut() disparado em segundo plano (branches
  // contaDesativada/perfilNaoEncontrado) anota a geração
  // vigente no momento do disparo; se o SIGNED_OUT correspondente só
  // chegar depois de uma sessão mais nova já ter sido estabelecida, a
  // geração não bate mais e o evento atrasado é ignorado em vez de
  // derrubar a sessão válida.
  const geracaoRef = useRef(0);
  const signOutEmVooRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const carregarPerfilUsuario = async (session) => {
      if (cancelled) return;

      if (!session) {
        if (!cancelled) {
          setSessao(null);
          setPerfil(null);
          setProfessorId(null);
          setNomeUsuario(null); // #18
          setContaDesativada(false);
          setPerfilNaoEncontrado(false);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setSessao((prev) => (prev?.user?.id === session.user.id ? prev : session));

      // FIX Issue 2: se o perfil já foi carregado para este mesmo user.id, reutiliza.
      // Se for um user.id diferente (login de outro usuário na mesma aba),
      // força recarregar mesmo que perfilJaCarregado.current seja true.
      if (perfilJaCarregado.current && perfilCarregadoParaId.current === session.user.id) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Reset para garantir que um usuário diferente não herde o perfil do anterior.
      perfilJaCarregado.current = false;
      geracaoRef.current += 1;

      // Usa auth_id (UUID do Supabase Auth) em vez de email.
      // Isso garante que alterações de email no painel do Auth não quebrem o lookup.
      const authId = session.user.id;

      try {
        // ILU-98: os dois cadastros entram na decisão (lib/perfilAcesso.js).
        // Antes, um cadastro de aluno inativo desconectava um professor ativo.
        const acesso = await buscarAcesso(authId);

        if (cancelled) return;

        if (acesso.perfil) {
          perfilJaCarregado.current = true;
          perfilCarregadoParaId.current = authId;
          setPerfil(acesso.perfil);
          setProfessorId(acesso.professorId);
          // #18: só o professor tem o nome exposto aqui.
          setNomeUsuario(acesso.perfil === 'professor' ? acesso.nome : null);
          setContaDesativada(false);
          setPerfilNaoEncontrado(false); // ILU-39
          setLoading(false);
          return;
        }

        if (acesso.bloqueio === 'desativado') {
          perfilJaCarregado.current = true;
          perfilCarregadoParaId.current = authId;
          setContaDesativada(true);
          setPerfil(null);
          setProfessorId(null);
          setNomeUsuario(null);
          setLoading(false);
          signOutEmVooRef.current = geracaoRef.current;
          await supabase.auth.signOut();
          return;
        }

        perfilJaCarregado.current = true;
        perfilCarregadoParaId.current = authId;
        console.warn('Nenhum perfil encontrado para auth_id:', authId);
        // ILU-39: sem isso, `sessao` continuava preenchida com `perfil = null`,
        // o que travava o usuário num loop infinito entre /login e
        // /area-aluno (App.jsx manda pra lá quando há sessão, e a rota
        // privada manda de volta pro /login por falta de perfil).
        //
        // Testado ao vivo: espelhar o branch de conta desativada (setLoading(false)
        // e só then aguardar signOut()) reproduz exatamente esse loop — o
        // React Router alterna entre as duas rotas mais rápido do que o
        // round-trip de rede do signOut(), e o React desiste de renderizar
        // ("Maximum update depth exceeded"), deixando a tela em branco e a
        // sessão presa. Por isso aqui `sessao` é limpa no mesmo lote de
        // estado que `perfil`, antes de qualquer render acontecer, e o
        // signOut() roda em segundo plano só para invalidar o token no
        // servidor/localStorage — sem bloquear a UI nem participar da corrida.
        setPerfilNaoEncontrado(true);
        setPerfil(null);
        setProfessorId(null);
        setNomeUsuario(null);
        setSessao(null);
        setLoading(false);
        signOutEmVooRef.current = geracaoRef.current;
        supabase.auth.signOut().catch(() => {});
        return;
      } catch (error) {
        console.error('Erro fatal ao carregar perfil:', error);
        if (cancelled) return;
        perfilJaCarregado.current = true;
        perfilCarregadoParaId.current = authId;
        setPerfil(null);
        setProfessorId(null);
        setNomeUsuario(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) carregarPerfilUsuario(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        // ILU-64: um signOut() de "kick-out" (branches acima) anotou a
        // geração vigente no momento do disparo. Se uma sessão mais nova
        // já foi estabelecida desde então, este SIGNED_OUT chegou
        // atrasado e não corresponde mais à sessão atual — ignora, em
        // vez de derrubar a sessão válida como se fosse um logout real.
        if (signOutEmVooRef.current !== null && geracaoRef.current !== signOutEmVooRef.current) {
          signOutEmVooRef.current = null;
          return;
        }
        signOutEmVooRef.current = null;
        perfilJaCarregado.current = false;
        perfilCarregadoParaId.current = null;
        setSessao(null);
        setPerfil(null);
        setProfessorId(null);
        setNomeUsuario(null); // #18
        setContaDesativada(false);
        // ILU-39: perfilNaoEncontrado NÃO é resetado aqui de propósito — este
        // SIGNED_OUT é disparado pelo próprio signOut() em segundo plano do
        // branch "nenhum perfil encontrado" acima, e a mensagem só chega a
        // aparecer na tela de Login se sobreviver a esse evento. Ela só volta
        // a ser limpa quando um novo login encontra um perfil válido.
        setLoading(false);

      } else if (event === 'SIGNED_IN') {
        if (perfilJaCarregado.current && perfilCarregadoParaId.current === session?.user?.id) {
          setSessao(session);
          return;
        }

        perfilJaCarregado.current = false;
        setLoading(true);
        carregarPerfilUsuario(session);

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

  return {
    sessao, perfil, professorId, nomeUsuario, loading,
    contaDesativada, perfilNaoEncontrado,
  };
}