import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { UserPlus, Users, Edit2, Ban, Trash2 } from 'lucide-react';
import { PALETA_CORES } from '../../../lib/constants';
import Button from '../../../components/ui/Button';

export default function ModalAcoesEvento({ evento, isAdmin, onAgendar, onChamada, onEditar, onEncerrar, onExcluir }) {
  if (!evento) return null;

  // brand colors — not themed by design (Cores de conteúdo da agenda)
  const corTema = PALETA_CORES.find(c => c.id === (evento.dadosOriginais.cor || 'laranja')) || PALETA_CORES[0];

  return (
    <div className="space-y-4 pt-2">
      {/* Banner Temático da Aula */}
      <div className="p-5 rounded-2xl border" style={{ backgroundColor: corTema.bg, borderColor: corTema.border }}>
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-black text-xl" style={{ color: corTema.text }}>{evento.title}</h3>
          <span className="bg-white/90 px-3 py-1 rounded-lg text-xs font-bold shadow-sm" style={{ color: corTema.text }}>
            {format(evento.start, 'HH:mm')}
          </span>
        </div>
        <p className="text-sm font-medium" style={{ color: corTema.text, opacity: 0.8 }}>
          Prof: {evento.dadosOriginais.professores?.nome || 'Não definido'}
        </p>
        <p className="text-sm font-medium" style={{ color: corTema.text, opacity: 0.7 }}>
  Modalidade: {evento.dadosOriginais.modalidades?.nome || '—'}
</p>
      </div>

      <Button 
        variant="success" 
        size="lg" 
        fullWidth 
        onClick={() => onAgendar(evento)}
      >
        <UserPlus size={20} /> Agendar Aluno nesta Turma
      </Button>
      
      <Button 
        variant="info" 
        size="lg" 
        fullWidth 
        onClick={() => onChamada(evento)}
      >
        <Users size={20} /> Fazer Chamada / Lista de Alunos
      </Button>
      
      {isAdmin && (
        <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
          <Button 
            variant="secondary" 
            fullWidth 
            onClick={() => onEditar(evento)}
          >
            <Edit2 size={18} /> Editar Cadastro da Grade
          </Button>
          
          <div className="flex gap-2">
            {evento.dadosOriginais.eh_recorrente && !evento.dadosOriginais.data_fim && (
              <Button 
                variant="ghost" 
                className="flex-1 bg-warning-soft text-warning hover:bg-warning/20"
                onClick={() => onEncerrar(evento)}
              >
                <Ban size={18} /> Encerrar Turma
              </Button>
            )}
            <Button 
              variant="destructive" 
              className="flex-1"
              onClick={() => onExcluir(evento)}
            >
              <Trash2 size={18} /> Excluir Grade
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}