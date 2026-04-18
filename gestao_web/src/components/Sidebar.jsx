import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Calendar, LogOut, 
  Package, TrendingDown, UserCheck, Calculator, X,
  Gift
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function Sidebar({ perfil, menuAberto, setMenuAberto }) {
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

  const menuAdmin = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Professores', path: '/professores', icon: Users },
    { name: 'Alunos', path: '/alunos', icon: Users },
    { name: 'Agenda', path: '/agenda', icon: Calendar },
    { name: 'Aniversariantes', path: '/aniversariantes', icon: Gift },
    { name: 'Financeiro', path: '/financeiro', icon: LayoutDashboard },
    { name: 'Comissões', path: '/comissoes', icon: Calculator },
    { name: 'Planos', path: '/planos', icon: Package },
    { name: 'Modalidades', path: '/modalidades', icon: Package },
    { name: 'Despesas', path: '/despesas', icon: TrendingDown },
    { name: 'Presença', path: '/presenca', icon: UserCheck },
  ];

  const menuProfessor = [
    { name: 'Agenda', path: '/agenda', icon: Calendar },
  ];

  const menu = perfil === 'professor' ? menuProfessor : menuAdmin;

  return (
    <>
      <div 
        className={`md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${menuAberto ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuAberto(false)}
      />

      {/* MENU LATERAL */}
      <div className={`fixed md:static inset-y-0 left-0 z-50 w-72 md:w-64 bg-white h-screen border-r border-orange-100 p-6 flex flex-col transition-transform duration-300 ease-in-out ${menuAberto ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        
        <div className="flex justify-between items-center mb-10 px-2">
          <h2 className="text-xl font-bold text-iluminus-terracota">Espaço Iluminus 🍀</h2>
          <button className="md:hidden text-gray-400 hover:text-gray-800 bg-gray-50 p-2 rounded-lg" onClick={() => setMenuAberto(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-2">
          {menu.map((item) => {
            const Icon = item.icon;
            const ativo = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                onClick={() => setMenuAberto(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  ativo ? 'bg-iluminus-terracota text-white shadow-md shadow-orange-200' : 'text-gray-500 hover:bg-iluminus-fundo hover:text-gray-800'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="pt-6 border-t border-gray-100 mt-4">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
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