import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Calendar, LogOut, 
  Package, TrendingDown, UserCheck, Calculator, X,
  Gift, Clock, TableConfigIcon, Bell,
  Sun, Moon, Percent, DollarSign // <-- Adicionado o DollarSign
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../hooks/ThemeContext';

function Sidebar({ perfil, menuAberto, setMenuAberto }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      localStorage.clear();
      navigate('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  }

  // Novo formato: Inserimos objetos { label: 'Nome' } para criar os separadores
  const menuAdmin = [
    { label: 'Visão Geral' },
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Notificações', path: '/notificacoes', icon: Bell },
    { name: 'Leads', path: '/leads', icon: Clock },
    
    { label: 'Gestão e Operação' },
    { name: 'Alunos', path: '/alunos', icon: Users },
    { name: 'Professores', path: '/professores', icon: Users },
    { name: 'Agenda', path: '/agenda', icon: Calendar },
    { name: 'Presença', path: '/presenca', icon: UserCheck },
    { name: 'Aniversariantes', path: '/aniversariantes', icon: Gift },
    
    { label: 'Financeiro' },
    { name: 'Financeiro', path: '/financeiro', icon: DollarSign }, // Ícone atualizado
    { name: 'Comissões', path: '/comissoes', icon: Calculator },
    { name: 'Despesas', path: '/despesas', icon: TrendingDown },
    
    { label: 'Configurações' },
    { name: 'Planos', path: '/planos', icon: Package },
    { name: 'Modalidades', path: '/modalidades', icon: Package },
    { name: 'Repasses', path: '/configuracoes/repasse', icon: Percent },
    { name: 'Sistema', path: '/configuracoes/feriados', icon: TableConfigIcon },
  ];

  const menuProfessor = [
    { label: 'Minhas Aulas' },
    { name: 'Agenda', path: '/agenda', icon: Calendar },
  ];

  const menu = perfil === 'professor' ? menuProfessor : menuAdmin;

  return (
    <>
      <div 
        className={`md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${menuAberto ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuAberto(false)}
      />

      <div className={`fixed md:static inset-y-0 left-0 z-50 w-72 md:w-64 bg-white dark:bg-[#121212] h-screen border-r border-orange-100 dark:border-zinc-800 p-6 flex flex-col transition-transform duration-300 ease-in-out ${menuAberto ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        
        <div className="flex justify-between items-center mb-8 px-2">
          <h2 className="text-xl font-bold text-iluminus-terracota dark:text-yellow-400 transition-colors">Espaço Iluminus 🍀</h2>
          <button className="md:hidden text-gray-400 hover:text-gray-800 dark:hover:text-white bg-gray-50 dark:bg-zinc-800 p-2 rounded-lg transition-colors" onClick={() => setMenuAberto(false)}>
            <X size={20} />
          </button>
        </div>

        {/* space-y-1 para agrupar melhor os botões embaixo dos seus labels */}
        <nav className="flex-1 space-y-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
          {menu.map((item, index) => {
            // Se o objeto for um 'label', renderiza o separador de grupo
            if (item.label) {
              return (
                <div key={`label-${index}`} className="pt-5 pb-2 first:pt-0 px-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-zinc-500">
                    {item.label}
                  </p>
                </div>
              );
            }

            // Se for um item de menu normal, renderiza o Link
            const Icon = item.icon;
            const ativo = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                onClick={() => setMenuAberto(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  ativo 
                    ? 'bg-iluminus-terracota text-white shadow-md shadow-orange-200 dark:bg-yellow-400 dark:text-black dark:shadow-yellow-900/20' 
                    : 'text-gray-500 hover:bg-iluminus-fundo hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-yellow-400'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="pt-6 border-t border-gray-100 dark:border-zinc-800 mt-2 space-y-2 transition-colors">
          <button 
            onClick={toggleTheme}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-all font-bold bg-gray-50 hover:bg-gray-100 text-gray-700 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 dark:text-yellow-400"
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            <span>{theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}</span>
          </button>

          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full text-gray-500 hover:text-red-500 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-950/30 rounded-xl transition-all"
          >
            <LogOut size={20} />
            <span className="font-medium">Sair do Sistema</span>
          </button>
        </div>
      </div>
    </>
  );
}

export default React.memo(Sidebar);