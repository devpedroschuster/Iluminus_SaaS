import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { RefreshCw, Menu } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { useAuth } from './hooks/useAuth';
import { rotaPorPerfil } from './lib/navigation';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';
import Sidebar from './components/Sidebar';
import { PWABanners } from './components/PWABanners';
import { PushNotificationBanner } from './components/PushNotificationBanner';
import PaginaNaoEncontrada from './components/PaginaNaoEncontrada'; // #19

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
import ProfessorAlunos   from './pages/Professor/ProfessorAlunos';
import ProfessorComissoes from './pages/Professor/ProfessorComissoes';
import ResultadoFinanceiro from './pages/ResultadoFinanceiro';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const resolverPerfilLayout = (perfil) => perfil;

function Spinner() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <RefreshCw className="animate-spin text-primary" size={48} />
    </div>
  );
}

// #17 — recebe nomeUsuario e repassa para Sidebar
const LayoutComSidebar = ({ perfil, nomeUsuario }) => {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex h-screen bg-background transition-colors duration-300 overflow-hidden w-full">
      <Sidebar
        perfil={perfil}
        nomeUsuario={nomeUsuario}
        menuAberto={menuAberto}
        setMenuAberto={setMenuAberto}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden w-full max-w-full">

        {/* Header Superior Mobile */}
        <div className="md:hidden flex items-center justify-between bg-card border-b border-border p-4 shrink-0 z-10 shadow-sm transition-colors duration-300">
          <div>
            <h2 className="text-xl font-black text-primary tracking-tight leading-none">Iluminus</h2>
            {resolverPerfilLayout(perfil) === 'professor' && (
              <p className="text-[11px] font-bold text-muted-foreground mt-0.5">Área do Professor</p>
            )}
          </div>
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

      {/* Banners PWA: instalar app + notificação de update */}
      <PWABanners />
      {resolverPerfilLayout(perfil) === 'professor' && <PushNotificationBanner />}
    </div>
  );
};

const RotaPrivada = ({ sessao, perfil, loading, allowedRoles }) => {
  if (loading) return <Spinner />;
  if (!sessao || perfil === null) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(perfil)) {
    return <Navigate to={rotaPorPerfil(perfil)} replace />;
  }
  return <Outlet />;
};

export default function App() {
  // #18 — desestrutura nomeUsuario do hook
  const { sessao, perfil, loading, nomeUsuario } = useAuth();

  if (loading) return <Spinner />;

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
                  : <Navigate to={rotaPorPerfil(perfil)} replace />
              } />
              <Route path="/login" element={
                !sessao
                  ? <Login />
                  : <Navigate to={rotaPorPerfil(perfil)} replace />
              } />
              <Route path="/redefinir-senha" element={<RedefinirSenha />} />

              {/* Rotas de Aluno */}
              <Route element={<RotaPrivada sessao={sessao} perfil={perfil} loading={loading} allowedRoles={['aluno']} />}>
                <Route path="/area-aluno" element={<AreaAluno />} />
              </Route>

              {/* Rotas Compartilhadas (Admin e Professor) */}
              <Route element={<RotaPrivada sessao={sessao} perfil={perfil} loading={loading} allowedRoles={['admin', 'professor']} />}>
                {/* #17/#18 — passa nomeUsuario para o layout */}
                <Route element={<LayoutComSidebar perfil={perfil} nomeUsuario={nomeUsuario} />}>
                  <Route path="/agenda"               element={<Agenda />} />
                  <Route path="/professor/alunos"     element={<ProfessorAlunos />} />
                  <Route path="/professor/comissoes"  element={<ProfessorComissoes />} />
                </Route>
              </Route>

              {/* Rotas Exclusivas do Admin */}
              <Route element={<RotaPrivada sessao={sessao} perfil={perfil} loading={loading} allowedRoles={['admin']} />}>
                {/* #17/#18 — passa nomeUsuario para o layout */}
                <Route element={<LayoutComSidebar perfil={perfil} nomeUsuario={nomeUsuario} />}>
                  <Route path="/dashboard"                  element={<Dashboard />} />
                  <Route path="/leads"                      element={<Leads />} />
                  <Route path="/alunos"                     element={<Alunos />} />
                  <Route path="/alunos/novo"                element={<NovoAluno />} />
                  <Route path="/alunos/:id"                 element={<PerfilAluno />} />
                  <Route path="/professores"                element={<Professores />} />
                  <Route path="/financeiro"                 element={<Financeiro />} />
                  <Route path="/despesas"                   element={<Despesas />} />
                  <Route path="/resultado-financeiro"       element={<ResultadoFinanceiro />} />
                  <Route path="/planos"                     element={<Planos />} />
                  <Route path="/modalidades"                element={<Modalidades />} />
                  <Route path="/presenca"                   element={<Presenca />} />
                  <Route path="/comissoes"                  element={<Comissoes />} />
                  <Route path="/aniversariantes"            element={<Aniversariantes />} />
                  <Route path="/configuracoes/feriados"     element={<ConfiguracoesFeriados />} />
                  <Route path="/notificacoes"               element={<Notificacoes />} />
                  <Route path="/configuracoes/repasse"      element={<ConfiguracoesRepasse />} />
                </Route>
              </Route>

              {/* #19 — 404 personalizado com redirect automático */}
              <Route
                path="*"
                element={
                  <PaginaNaoEncontrada destino={sessao ? rotaPorPerfil(perfil) : '/'} />
                }
              />
            </Routes>
          </BrowserRouter>
        </ThemeProvider>
      </ErrorBoundary>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}