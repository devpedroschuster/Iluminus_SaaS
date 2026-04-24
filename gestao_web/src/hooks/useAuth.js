import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const perfilJaCarregado = useRef(false);

  useEffect(() => {
    const carregarPerfilUsuario = async (session) => {
      if (!session) {
        setSessao(null);
        setPerfil(null);
        setLoading(false);
        return;
      }

      setSessao((prev) => (prev?.user?.id === session.user.id ? prev : session));

      if (perfilJaCarregado.current) {
        setLoading(false);
        return;
      }

      const email = session.user.email;

      try {
        const { data: usuario, error: errAluno } = await supabase.from('alunos').select('id, role').eq('email', email).maybeSingle();
        if (errAluno && errAluno.code !== 'PGRST116') console.error("Erro ao verificar aluno:", errAluno);
        
        if (usuario) {
          perfilJaCarregado.current = true;
          setPerfil(usuario.role === 'admin' ? 'admin' : 'aluno');
          setLoading(false);
          return;
        }

        const { data: professor, error: errProf } = await supabase.from('professores').select('id').eq('email', email).maybeSingle();
        if (errProf && errProf.code !== 'PGRST116') console.error("Erro ao verificar professor:", errProf);
        
        if (professor) {
          perfilJaCarregado.current = true;
          setPerfil('professor');
          setLoading(false);
          return;
        }

        perfilJaCarregado.current = true;
        setPerfil('admin');
      } catch (error) {
        console.error("Erro fatal ao carregar perfil:", error);
        perfilJaCarregado.current = true;
        setPerfil('admin'); 
      } finally {
        setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      carregarPerfilUsuario(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        perfilJaCarregado.current = false;
        setSessao(null);
        setPerfil(null);
      } else {
        carregarPerfilUsuario(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return { sessao, perfil, loading };
}