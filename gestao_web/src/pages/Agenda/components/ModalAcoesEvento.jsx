import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  UserPlus, Users, Edit2, Ban, Trash2,
  Clock, MapPin, Dumbbell, Music, User, Hash
} from 'lucide-react';
import { PALETA_CORES } from '../../../lib/constants';
import Button from '../../../components/ui/Button';

// ─── Ficha de informações somente-leitura (professor) ──────────────────────
function DetalheAula({ evento, corTema }) {
  const d = evento.dadosOriginais;
  const duracaoLabel = d.duracao_minutos
    ? d.duracao_minutos < 60
      ? `${d.duracao_minutos} min`
      : `${Math.floor(d.duracao_minutos / 60)}h${d.duracao_minutos % 60 ? ` ${d.duracao_minutos % 60} min` : ''}`
    : '—';

  const rows = [
    { icon: <User       size={15} />, label: 'Professor',   value: d.professores?.nome || 'Não definido' },
    { icon: <Hash       size={15} />, label: 'Modalidade',  value: d.modalidades?.nome || '—'            },
    { icon: <Clock      size={15} />, label: 'Horário',     value: `${format(evento.start, 'HH:mm')} · ${duracaoLabel}` },
    { icon: <MapPin     size={15} />, label: 'Espaço',
      value: d.espaco === 'funcional' ? 'Funcional' : 'Dança',
      icon2: d.espaco === 'funcional' ? <Dumbbell size={15} /> : <Music size={15} />,
    },
    { icon: <Users      size={15} />, label: 'Vagas',       value: d.capacidade ? `${d.capacidade} alunos` : '—' },
  ];

  return (
    <div className="mt-3 space-y-2">
      {rows.map(({ icon, icon2, label, value }) => (
        <div key={label} className="flex items-center gap-3 px-1 py-1.5">
          <span className="text-muted-foreground flex-shrink-0">{icon2 ?? icon}</span>
          <span className="text-xs font-bold text-muted-foreground uppercase w-24 flex-shrink-0">{label}</span>
          <span className="text-sm font-semibold text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function ModalAcoesEvento({ 
  evento, isAdmin, professorIdLogado, onAgendar, onChamada, onEditar, onEncerrar, onExcluir 
}) {
  if (!evento) return null;

  const corTema = PALETA_CORES.find(c => c.id === (evento.dadosOriginais.cor || 'laranja')) || PALETA_CORES[0];

  return (
    <div className="space-y-4 pt-2">
      {/* Card colorido com nome e horário */}
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

      {/* Ficha de detalhes — professor vê mais info, admin vê resumo igual */}
      {!isAdmin && <DetalheAula evento={evento} corTema={corTema} />}

      {/* Ações disponíveis para todos os perfis */}
      {isAdmin && (
        <Button variant="success" size="lg" fullWidth onClick={() => onAgendar(evento)}>
          <UserPlus size={20} /> Agendar Aluno nesta Turma
        </Button>
      )}

      <Button variant="info" size="lg" fullWidth onClick={() => onChamada(evento)}>
        <Users size={20} /> Lista de Presença
      </Button>

      {/* Ações exclusivas de admin */}
      {isAdmin && (
        <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
          <Button variant="secondary" fullWidth onClick={() => onEditar(evento)}>
            <Edit2 size={18} /> Editar Cadastro da Grade
          </Button>

          <div className="flex gap-2">
            {evento.dadosOriginais.eh_recorrente && !evento.dadosOriginais.data_fim && (
              <Button
                variant="ghost"
                className="flex-1 bg-warning-soft text-warning hover:bg-warning/20"
                onClick={() => onEncerrar(evento)}
              >
                <Ban size={18} /> Cancelar Aula
              </Button>
            )}
            <Button variant="destructive" className="flex-1" onClick={() => onExcluir(evento)}>
              <Trash2 size={18} /> Excluir Grade
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}