import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Calendar, Download, LogOut, 
  Package, TrendingDown, UserCheck, Calculator, X,
  Clock, Bell, Percent, DollarSign, Gift, TableConfigIcon,
  CreditCard
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import ThemeToggle from './ui/ThemeToggle';
import { usePWA } from '../hooks/usePWA';

function resolverPerfil(perfil) {
  if (!perfil) return 'admin';
  if (typeof perfil === 'string') return perfil.toLowerCase().trim();
  const valor = perfil.role ?? perfil.tipo ?? 'admin';
  return String(valor).toLowerCase().trim();
}

function Sidebar({ perfil, menuAberto, setMenuAberto }) {
  const location = useLocation();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      Object.keys(localStorage)
        .filter(key => key.startsWith('supabase.'))
        .forEach(key => localStorage.removeItem(key));
      navigate('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  }

  const menuAdmin = [
    { label: 'Visão Geral' },
    { name: 'Painel Avisos', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Notificações', path: '/notificacoes', icon: Bell },
    { name: 'Leads', path: '/leads', icon: Clock },
    { name: 'Aniversariantes', path: '/aniversariantes', icon: Gift },
    
    { label: 'Gestão e Operação' },
    { name: 'Alunos', path: '/alunos', icon: Users },
    { name: 'Planos', path: '/planos', icon: CreditCard },
    { name: 'Professores', path: '/professores', icon: UserCheck },
    { name: 'Modalidades', path: '/modalidades', icon: Package },
    { name: 'Agenda', path: '/agenda', icon: Calendar },
    { name: 'Presença', path: '/presenca', icon: Clock },
    { name: 'Feriados', path: '/configuracoes/feriados', icon: TableConfigIcon },
    
    { label: 'Financeiro' },
    { name: 'Mensalidades', path: '/financeiro', icon: DollarSign },
    { name: 'Despesas', path: '/despesas', icon: TrendingDown },
    { name: 'Resultado Financeiro', path: '/resultado-financeiro', icon: Calculator },
    { name: 'Comissões', path: '/comissoes', icon: Percent },
    { name: 'Repasse Regras', path: '/configuracoes/repasse', icon: Calculator },
  ];

  const menuProfessor = [
  { label: 'Menu Professor' },
  { name: 'Minha Agenda',      path: '/agenda',             icon: Calendar },
  { name: 'Meus Alunos',       path: '/professor/alunos',   icon: Users    },
  { name: 'Minhas Comissões',  path: '/professor/comissoes', icon: Percent  },
];

  const isProfessor = resolverPerfil(perfil) === 'professor';
  const itensMenu = isProfessor ? menuProfessor : menuAdmin;
  const { canInstall, install } = usePWA();

  return (
    <>
      {/* Overlay Mobile */}
      {menuAberto && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden transition-all"
          onClick={() => setMenuAberto(false)}
        />
      )}

      {/* Container Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-72 bg-card border-r border-border
        transform transition-transform duration-300 ease-in-out
        flex flex-col h-full
        ${menuAberto ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        
        {/* Header / Logo */}
        <div className="p-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
              <span className="text-primary-foreground font-black text-xl">I</span>
            </div>
            <h1 className="text-2xl font-black text-foreground tracking-tighter">
              Iluminus
            </h1>
          </div>
          
          <button 
            onClick={() => setMenuAberto(false)}
            className="md:hidden p-2 text-muted-foreground hover:bg-subtle rounded-xl border border-border bg-card"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navegação */}
        <nav className="flex-1 overflow-y-auto px-4 space-y-1 custom-scrollbar">
          {itensMenu.map((item, index) => {
            if (item.label) {
              return (
                <p key={`label-${index}`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 px-4 mt-6 mb-2">
                  {item.label}
                </p>
              );
            }

            const Icon = item.icon;
            const ativo = location.pathname === item.path;

            return (
              <Link 
                key={item.path} 
                to={item.path}
                onClick={() => setMenuAberto(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all
                  ${ativo 
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' 
                    : 'text-muted-foreground hover:bg-subtle hover:text-foreground'}
                `}
              >
                <Icon size={20} />
                <span className="text-sm">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Rodapé da Sidebar */}
        <div className="p-4 border-t border-border mt-auto space-y-2">
          <div className="flex justify-center w-full pb-2">
            <ThemeToggle />
          </div>

          {canInstall && (
    <button 
      onClick={install}
      className="flex items-center gap-3 px-4 py-3 w-full text-primary font-bold hover:bg-primary/10 rounded-xl transition-all"
    >
      <Download size={20} />
      <span className="text-sm">Instalar Aplicativo</span>
    </button>
  )}

          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full text-muted-foreground font-bold hover:text-destructive hover:bg-destructive-soft rounded-xl transition-all"
          >
            <LogOut size={20} />
            <span className="text-sm">Sair do Sistema</span>
          </button>
          
          <div className="px-4 py-2">
            <p className="text-[10px] text-muted-foreground/40 font-medium text-center italic">
              v3.0
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;