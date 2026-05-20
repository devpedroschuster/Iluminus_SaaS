import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { RefreshCw, Menu } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { useAuth } from './hooks/useAuth';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';
import Sidebar from './components/Sidebar';

import Login from './pages/Login';
import RedefinirSenha from './pages/RedefinirSenha';
import Dashboard from './pages/Dashboard';
import Alunos from './pages/Alunos';
import NovoAluno from './pages/NovoAluno';
import PerfilAluno from './pages/PerfilAluno';
import Leads from './pages/Leads';
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
import ConfiguracoesFeriados from './pages/ConfiguracoesFeriados';
import Notificacoes from './pages/Notificacoes';
import ConfiguracoesRepasse from './pages/ConfiguracoesRepasse';
import ProfessorAlunos   from './pages/professor/ProfessorAlunos';
import ProfessorComissoes from './pages/professor/ProfessorComissoes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
const LayoutComSidebar = ({ perfil }) => {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex h-screen bg-background transition-colors duration-300 overflow-hidden w-full">
      <Sidebar perfil={perfil} menuAberto={menuAberto} setMenuAberto={setMenuAberto} />
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden w-full max-w-full">
        {/* Header Superior Mobile */}
        <div className="md:hidden flex items-center justify-between bg-card border-b border-border p-4 shrink-0 z-10 shadow-sm transition-colors duration-300">
           <h2 className="text-xl font-black text-primary tracking-tight">Iluminus</h2>
           <button 
             onClick={() => setMenuAberto(true)} 
             className="p-2 text-muted-foreground bg-muted rounded-xl hover:bg-subtle transition-colors"
           >
             <Menu size={24} />
           </button>
        </div>
        <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
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
  const { sessao, perfil, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <RefreshCw className="animate-spin text-primary" size={48} />
      </div>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <ThemeProvider>
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
            {/* Rotas de Aluno */}
            <Route element={<RotaPrivada sessao={sessao} perfil={perfil} allowedRoles={['aluno']} />}>
               <Route path="/area-aluno" element={<AreaAluno />} />
            </Route>
            {/* Rotas Compartilhadas (Admin e Professor) */}
            <Route element={<RotaPrivada sessao={sessao} perfil={perfil} allowedRoles={['admin', 'professor']} />}>
  <Route element={<LayoutComSidebar perfil={perfil} />}>
    <Route path="/agenda"               element={<Agenda />} />
    <Route path="/professor/alunos"     element={<ProfessorAlunos />} />
    <Route path="/professor/comissoes"  element={<ProfessorComissoes />} />
  </Route>
</Route>
            {/* Rotas Exclusivas do Admin */}
            <Route element={<RotaPrivada sessao={sessao} perfil={perfil} allowedRoles={['admin']} />}>
              <Route element={<LayoutComSidebar perfil={perfil} />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/alunos" element={<Alunos />} />
                <Route path="/alunos/novo" element={<NovoAluno />} />
                <Route path="/alunos/:id" element={<PerfilAluno />} />
                <Route path="/professores" element={<Professores />} />
                <Route path="/financeiro" element={<Financeiro />} />
                <Route path="/despesas" element={<Despesas />} />
                <Route path="/planos" element={<Planos />} />
                <Route path="/modalidades" element={<Modalidades />} />
                <Route path="/presenca" element={<Presenca />} />
                <Route path="/comissoes" element={<Comissoes />} />
                <Route path="/aniversariantes" element={<Aniversariantes />} />
                <Route path="/configuracoes/feriados" element={<ConfiguracoesFeriados />} />
                <Route path="/notificacoes" element={<Notificacoes />} />
                <Route path="/configuracoes/repasse" element={<ConfiguracoesRepasse />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </ThemeProvider>
      </ErrorBoundary>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
