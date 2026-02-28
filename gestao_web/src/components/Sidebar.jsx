import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Calendar, LogOut, 
  Package, TrendingDown, UserCheck 
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      localStorage.clear();
      navigate('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  }

  const menu = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Alunos', path: '/alunos', icon: Users },
    { name: 'Agenda', path: '/agenda', icon: Calendar },
    { name: 'Financeiro', path: '/financeiro', icon: LayoutDashboard },
    { name: 'Planos', path: '/planos', icon: Package },
    { name: 'Despesas', path: '/despesas', icon: TrendingDown },
    { name: 'Presença', path: '/presenca', icon: UserCheck },
  ];

  return (
    <div className="w-64 bg-white h-screen border-r border-orange-100 p-6 flex flex-col">
      <div className="mb-10 px-2">
        <h2 className="text-xl font-bold text-iluminus-terracota">Iluminus Admin</h2>
      </div>

      <nav className="flex-1 space-y-2">
        {menu.map((item) => {
          const Icon = item.icon;
          const ativo = location.pathname === item.path;
          return (
            <Link 
              key={item.path} 
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                ativo ? 'bg-iluminus-terracota text-white shadow-md shadow-orange-200' : 'text-gray-500 hover:bg-iluminus-fundo'
              }`}
            >
              <Icon size={20} />
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="pt-6 border-t border-gray-100">
        <button 
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 w-full text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
        >
          <LogOut size={20} />
          <span className="font-medium">Sair do Sistema</span>
        </button>
      </div>
    </div>
  );
}

// Otimização para evitar re-render desnecessário
export default React.memo(Sidebar);