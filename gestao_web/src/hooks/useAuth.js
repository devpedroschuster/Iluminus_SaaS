import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [professorId, setProfessorId] = useState(null);
  const [loading, setLoading] = useState(true);

  const perfilJaCarregado = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const carregarPerfilUsuario = async (session) => {
      if (cancelled) return;

      if (!session) {
        if (!cancelled) { setSessao(null); setPerfil(null); setProfessorId(null); setLoading(false); }
        return;
      }

      if (!cancelled) setSessao((prev) => (prev?.user?.id === session.user.id ? prev : session));

      if (perfilJaCarregado.current) {
        if (!cancelled) setLoading(false);
        return;
      }

      const email = session.user.email;

      try {
        const { data: usuario, error: errAluno } = await supabase
          .from('alunos').select('id, role').eq('email', email).maybeSingle();
        if (errAluno && errAluno.code !== 'PGRST116') console.error('Erro ao verificar aluno:', errAluno);

        if (cancelled) return;

        if (usuario) {
          perfilJaCarregado.current = true;
          setPerfil(usuario.role === 'admin' ? 'admin' : 'aluno');
          setProfessorId(null);
          setLoading(false);
          return;
        }

        const { data: professor, error: errProf } = await supabase
          .from('professores').select('id').eq('email', email).maybeSingle();
        if (errProf && errProf.code !== 'PGRST116') console.error('Erro ao verificar professor:', errProf);

        if (cancelled) return;

        if (professor) {
          perfilJaCarregado.current = true;
          setPerfil('professor');
          setProfessorId(professor.id);
          setLoading(false);
          return;
        }

        perfilJaCarregado.current = true;
        console.warn('Nenhum perfil encontrado para:', email);
        setPerfil(null);
        setProfessorId(null);
      } catch (error) {
        console.error('Erro fatal ao carregar perfil:', error);
        if (cancelled) return;
        perfilJaCarregado.current = true;
        setPerfil(null);
        setProfessorId(null);
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
        setSessao(null);
        setPerfil(null);
        setProfessorId(null);
        setLoading(false);

      } else if (event === 'SIGNED_IN') {
        if (perfilJaCarregado.current) {
          setSessao(session);
          return;
        }

        perfilJaCarregado.current = false;
        setLoading(true);
        carregarPerfilUsuario(session);

      } else {
        if (perfilJaCarregado.current) {
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

  return { sessao, perfil, professorId, loading };
}