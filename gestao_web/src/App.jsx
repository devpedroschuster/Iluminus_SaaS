import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { RefreshCw } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// Componentes Compartilhados
import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';
import Sidebar from './components/Sidebar';

// PÁGINAS (Todas devem ser importadas aqui)
import Login from './pages/Login';
import RedefinirSenha from './pages/RedefinirSenha';
import Dashboard from './pages/Dashboard';
import Alunos from './pages/Alunos';
import NovoAluno from './pages/NovoAluno';
import Agenda from './pages/Agenda';     // Faltava
import Financeiro from './pages/Financeiro'; // Faltava
import Despesas from './pages/Despesas';   // Faltava
import Planos from './pages/Planos';     // Faltava
import Presenca from './pages/Presenca';   // Faltava

// Configuração do React Query
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

// Componente de Rota Privada
const RotaPrivada = ({ sessao }) => {
  if (!sessao) return <Navigate to="/login" replace />;
  return <Outlet />;
};

// Layout com a Barra Lateral
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
    // 1. Verifica sessão atual
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessao(session);
      setLoading(false);
    });

    // 2. Escuta mudanças (Login/Logout)
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
            {/* Rotas Públicas */}
            <Route path="/login" element={!sessao ? <Login /> : <Navigate to="/dashboard" replace />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
            
            {/* Rotas Privadas (Protegidas) */}
            <Route element={<RotaPrivada sessao={sessao} />}>
              <Route element={<LayoutComSidebar />}>
                
                {/* AQUI ESTÃO AS ROTAS QUE FALTAVAM */}
                <Route path="/dashboard" element={<Dashboard />} />
                
                {/* Alunos */}
                <Route path="/alunos" element={<Alunos />} />
                <Route path="/alunos/novo" element={<NovoAluno />} />
                
                {/* Funcionalidades */}
                <Route path="/agenda" element={<Agenda />} />
                <Route path="/financeiro" element={<Financeiro />} />
                <Route path="/despesas" element={<Despesas />} />
                <Route path="/planos" element={<Planos />} />
                <Route path="/presenca" element={<Presenca />} />

              </Route>
            </Route>

            {/* Redirecionamento Padrão */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      {/* Ferramenta de desenvolvimento (opcional, aparece uma florzinha no canto) */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}