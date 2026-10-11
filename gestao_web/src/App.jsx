import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { RefreshCw, Menu } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { useAuth } from './hooks/useAuth';
import { rotaPorPerfil, decidirRotaPublica, decidirRotaPrivada } from './lib/navigation';
import { AuthProvider } from './providers/AuthProvider';
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
import ProfessorLeads from './pages/Professor/ProfessorLeads';
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

// ILU-99: as rotas decidem a partir do estado do login (lib/navigation.js). O
// roteador nunca é desmontado durante o carregamento do perfil: antes, o App
// trocava a árvore inteira por um spinner a cada login, e o navigate que o
// Login fazia para /redefinir-senha se perdia.
const RotaPrivada = ({ allowedRoles }) => {
  const destino = decidirRotaPrivada(useAuth(), allowedRoles);
  if (destino === 'carregando') return <Spinner />;
  if (destino !== 'liberado') return <Navigate to={destino} replace />;
  return <Outlet />;
};

// "/" e "/login": a própria página para quem não está logado, senão a tela do perfil.
const RotaPublica = ({ children }) => {
  const destino = decidirRotaPublica(useAuth());
  if (destino === 'carregando') return <Spinner />;
  if (destino !== 'pagina') return <Navigate to={destino} replace />;
  return children;
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <ThemeProvider>
          <AuthProvider>
            <BrowserRouter>
              <ToastProvider />
              <Rotas />
            </BrowserRouter>
          </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

function Rotas() {
  const { sessao, perfil, nomeUsuario } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<RotaPublica><Landing /></RotaPublica>} />
      <Route path="/login" element={<RotaPublica><Login /></RotaPublica>} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />

      {/* Rotas de Aluno */}
      <Route element={<RotaPrivada allowedRoles={['aluno']} />}>
        <Route path="/area-aluno" element={<AreaAluno />} />
      </Route>

      {/* Rotas Compartilhadas (Admin e Professor) */}
      <Route element={<RotaPrivada allowedRoles={['admin', 'professor']} />}>
        <Route element={<LayoutComSidebar perfil={perfil} nomeUsuario={nomeUsuario} />}>
          <Route path="/agenda"               element={<Agenda />} />
          <Route path="/professor/alunos"     element={<ProfessorAlunos />} />
          <Route path="/professor/comissoes"  element={<ProfessorComissoes />} />
          <Route path="/professor/leads"      element={<ProfessorLeads />} />
        </Route>
      </Route>

      {/* Rotas Exclusivas do Admin */}
      <Route element={<RotaPrivada allowedRoles={['admin']} />}>
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

      <Route
        path="*"
        element={
          <PaginaNaoEncontrada destino={sessao ? rotaPorPerfil(perfil) : '/'} />
        }
      />
    </Routes>
  );
}