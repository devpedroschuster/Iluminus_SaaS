import React, { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { RefreshCw, Menu } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';
import Sidebar from './components/Sidebar';

// Páginas do Painel Administrativo
import Login from './pages/Login';
import RedefinirSenha from './pages/RedefinirSenha';
import Dashboard from './pages/Dashboard';
import Alunos from './pages/Alunos';
import NovoAluno from './pages/NovoAluno';
import Professores from './pages/Professores';
import Agenda from './pages/Agenda/Agenda';     
import Financeiro from './pages/Financeiro'; 
import Despesas from './pages/Despesas';   
import Planos from './pages/Planos';
import Modalidades from './pages/Modalidades';
import Presenca from './pages/Presenca';
import Comissoes from './pages/Comissoes';  
import Aniversariantes from './pages/Aniversariantes';
import Landing from './pages/Landing';
import AreaAluno from './pages/AreaAluno';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      cacheTime: 1000 * 60 * 10,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// LAYOUT HEADER MOBILE
const LayoutComSidebar = ({ perfil }) => {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex h-screen bg-[#FDF8F5] overflow-hidden w-full">
      <Sidebar perfil={perfil} menuAberto={menuAberto} setMenuAberto={setMenuAberto} />
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden w-full max-w-full">
        {/* HEADER MOBILE */}
        <div className="md:hidden flex items-center justify-between bg-white border-b border-orange-100 p-4 shrink-0 z-10 shadow-sm">
           <h2 className="text-xl font-black text-iluminus-terracota tracking-tight">Iluminus</h2>
           <button onClick={() => setMenuAberto(true)} className="p-2 text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
             <Menu size={24} />
           </button>
        </div>

        <div className="flex-1 overflow-y-auto w-full">
          <Outlet context={{ perfil }} />
        </div>
      </div>
    </div>
  );
};

const RotaPrivada = ({ sessao, perfil, allowedRoles }) => {
  if (!sessao) return <Navigate to="/" replace />;
  if (allowedRoles && !allowedRoles.includes(perfil)) {
    if (perfil === 'aluno') return <Navigate to="/area-aluno" replace />;
    if (perfil === 'professor') return <Navigate to="/agenda" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
};

export default function App() {
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

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#FDF8F5]">
        <RefreshCw className="animate-spin text-orange-600" size={48} />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <ToastProvider /> 
          <Routes>
            <Route path="/" element={
              !sessao 
                ? <Landing /> 
                : (perfil === 'aluno' 
                    ? <Navigate to="/area-aluno" replace /> 
                    : (perfil === 'professor' 
                        ? <Navigate to="/agenda" replace /> 
                        : <Navigate to="/dashboard" replace />))
            } />
            <Route path="/login" element={
              !sessao 
                ? <Login /> 
                : (perfil === 'aluno' 
                    ? <Navigate to="/area-aluno" replace /> 
                    : (perfil === 'professor' 
                        ? <Navigate to="/agenda" replace /> 
                        : <Navigate to="/dashboard" replace />))
            } />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />

            <Route element={<RotaPrivada sessao={sessao} perfil={perfil} allowedRoles={['aluno']} />}>
               <Route path="/area-aluno" element={<AreaAluno />} />
            </Route>
            
            <Route element={<RotaPrivada sessao={sessao} perfil={perfil} allowedRoles={['admin', 'professor']} />}>
              <Route element={<LayoutComSidebar perfil={perfil} />}>
                <Route path="/agenda" element={<Agenda />} />
              </Route>
            </Route>

            <Route element={<RotaPrivada sessao={sessao} perfil={perfil} allowedRoles={['admin']} />}>
              <Route element={<LayoutComSidebar perfil={perfil} />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/alunos" element={<Alunos />} />
                <Route path="/alunos/novo" element={<NovoAluno />} />
                <Route path="/professores" element={<Professores />} />
                <Route path="/financeiro" element={<Financeiro />} />
                <Route path="/despesas" element={<Despesas />} />
                <Route path="/planos" element={<Planos />} />
                <Route path="/modalidades" element={<Modalidades />} />
                <Route path="/presenca" element={<Presenca />} />
                <Route path="/comissoes" element={<Comissoes />} />
                <Route path="/aniversariantes" element={<Aniversariantes />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}