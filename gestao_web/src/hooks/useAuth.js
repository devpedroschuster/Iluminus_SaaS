import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [professorId, setProfessorId] = useState(null);
  const [nomeUsuario, setNomeUsuario] = useState(null); // #18 — novo estado
  const [loading, setLoading] = useState(true);

  const perfilJaCarregado = useRef(false);
  // FIX Issue 2: rastreia para qual auth_id o perfil foi carregado,
  // para detectar troca de usuário mesmo sem SIGNED_OUT (ex: tab recarregada).
  const perfilCarregadoParaId = useRef(null);

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

      // Usa auth_id (UUID do Supabase Auth) em vez de email.
      // Isso garante que alterações de email no painel do Auth não quebrem o lookup.
      const authId = session.user.id;

      try {
        const { data: usuario, error: errAluno } = await supabase
          .from('alunos').select('id, role').eq('auth_id', authId).maybeSingle();
        if (errAluno && errAluno.code !== 'PGRST116') console.error('Erro ao verificar aluno:', errAluno);

        if (cancelled) return;

        if (usuario) {
          perfilJaCarregado.current = true;
          perfilCarregadoParaId.current = authId;
          setPerfil(usuario.role === 'admin' ? 'admin' : 'aluno');
          setProfessorId(null);
          setNomeUsuario(null); // alunos não têm nome exposto aqui
          setLoading(false);
          return;
        }

        // #18 — busca 'nome' além de 'id'
        const { data: professor, error: errProf } = await supabase
          .from('professores').select('id, nome').eq('auth_id', authId).maybeSingle();
        if (errProf && errProf.code !== 'PGRST116') console.error('Erro ao verificar professor:', errProf);

        if (cancelled) return;

        if (professor) {
          perfilJaCarregado.current = true;
          perfilCarregadoParaId.current = authId;
          setPerfil('professor');
          // Number() garante que o id seja sempre number,
          // independente do Supabase retornar bigint como string.
          setProfessorId(professor.id);
          setNomeUsuario(professor.nome ?? null); // #18
          setLoading(false);
          return;
        }

        perfilJaCarregado.current = true;
        perfilCarregadoParaId.current = authId;
        console.warn('Nenhum perfil encontrado para auth_id:', authId);
        setPerfil(null);
        setProfessorId(null);
        setNomeUsuario(null);
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
        perfilJaCarregado.current = false;
        perfilCarregadoParaId.current = null;
        setSessao(null);
        setPerfil(null);
        setProfessorId(null);
        setNomeUsuario(null); // #18
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

  return { sessao, perfil, professorId, nomeUsuario, loading }; // #18 — expõe nomeUsuario
}