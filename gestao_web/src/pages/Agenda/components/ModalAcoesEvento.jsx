import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { UserPlus, Users, Edit2, Ban, Trash2 } from 'lucide-react';
import { PALETA_CORES } from '../../../lib/constants';

export default function ModalAcoesEvento({ evento, isAdmin, onAgendar, onChamada, onEditar, onEncerrar, onExcluir }) {
  if (!evento) return null;

  const corTema = PALETA_CORES.find(c => c.id === (evento.dadosOriginais.cor || 'laranja')) || PALETA_CORES[0];

  return (
    <div className="space-y-4 pt-2">
      <div className="p-5 rounded-2xl border" style={{ backgroundColor: corTema.bg, borderColor: corTema.border }}>
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-black text-xl" style={{ color: corTema.text }}>{evento.title}</h3>
          <span className="bg-white px-3 py-1 rounded-lg text-xs font-bold shadow-sm" style={{ color: corTema.text }}>
            {format(evento.start, 'HH:mm')}
          </span>
        </div>
        <p className="text-sm font-medium" style={{ color: corTema.text, opacity: 0.8 }}>
          Prof: {evento.dadosOriginais.professores?.nome || 'Não definido'}
        </p>
        <p className="text-xs mt-2" style={{ color: corTema.text, opacity: 0.7 }}>
          {format(evento.start, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 mt-4">
        <button onClick={() => onAgendar(evento)} className="w-full bg-green-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-colors shadow-sm mb-2">
          <UserPlus size={20} /> Agendar Aluno Neste Horário
        </button>

        <button onClick={() => onChamada(evento)} className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-sm">
          <Users size={20} /> Fazer Chamada / Lista de Alunos
        </button>
        
        {isAdmin && (
          <div className="flex flex-col gap-2 mt-2">
            <button onClick={() => onEditar(evento)} className="w-full bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors">
              <Edit2 size={18} /> Editar Cadastro da Grade
            </button>
            
            <div className="flex gap-2">
              {evento.dadosOriginais.eh_recorrente && !evento.dadosOriginais.data_fim && (
                <button onClick={() => onEncerrar(evento)} className="flex-1 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-500 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors">
                  <Ban size={18} /> Encerrar Turma
                </button>
              )}
              <button onClick={() => onExcluir(evento)} className="flex-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                <Trash2 size={18} /> Excluir (Apagar Tudo)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}