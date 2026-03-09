import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { RefreshCw } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';
import Sidebar from './components/Sidebar';

import Login from './pages/Login';
import RedefinirSenha from './pages/RedefinirSenha';
import Dashboard from './pages/Dashboard';
import Alunos from './pages/Alunos';
import NovoAluno from './pages/NovoAluno';
import Professores from './pages/Professores';
import Agenda from './pages/Agenda';     
import Financeiro from './pages/Financeiro'; 
import Despesas from './pages/Despesas';   
import Planos from './pages/Planos';     
import Presenca from './pages/Presenca';
import Comissoes from './pages/Comissoes';  

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutos
      cacheTime: 1000 * 60 * 10,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RotaPrivada = ({ sessao }) => {
  if (!sessao) return <Navigate to="/login" replace />;
  return <Outlet />;
};

const LayoutComSidebar = () => (
  <div className="flex bg-[#FDF8F5] min-h-screen">
    <Sidebar />
    <div className="flex-1 overflow-y-auto max-h-screen">
      <Outlet />
    </div>
  </div>
);

export default function App() {
  const [sessao, setSessao] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessao(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessao(session);
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
            <Route path="/login" element={!sessao ? <Login /> : <Navigate to="/dashboard" replace />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
            
            <Route element={<RotaPrivada sessao={sessao} />}>
              <Route element={<LayoutComSidebar />}>
                
                <Route path="/dashboard" element={<Dashboard />} />
                
                <Route path="/alunos" element={<Alunos />} />
                <Route path="/alunos/novo" element={<NovoAluno />} />
                <Route path="/professores" element={<Professores />} />
                
                <Route path="/agenda" element={<Agenda />} />
                <Route path="/financeiro" element={<Financeiro />} />
                <Route path="/despesas" element={<Despesas />} />
                <Route path="/planos" element={<Planos />} />
                <Route path="/presenca" element={<Presenca />} />
                <Route path="/comissoes" element={<Comissoes />} />

              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}