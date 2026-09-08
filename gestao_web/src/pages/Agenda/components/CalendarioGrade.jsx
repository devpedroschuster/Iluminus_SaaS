import React from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users } from 'lucide-react';
import { PALETA_CORES } from '../../../lib/constants';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './CalendarioGrade.css';

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'pt-BR': ptBR } });

const formatosCalendario = {
  timeGutterFormat: 'HH:mm',
  eventTimeRangeFormat: () => '',
  agendaTimeRangeFormat: ({ start, end }, culture, loc) =>
    `${loc.format(start, 'HH:mm', culture)} - ${loc.format(end, 'HH:mm', culture)}`,
  dayHeaderFormat: 'EEEE, dd/MM',
  dayRangeHeaderFormat: ({ start, end }, culture, loc) =>
    `${loc.format(start, 'dd/MM', culture)} - ${loc.format(end, 'dd/MM', culture)}`,
};

const CustomToolbar = (toolbar) => (
  <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-card/60 backdrop-blur-md border border-border/60 rounded-2xl p-2 shadow-sm">
    <div className="flex items-center gap-2">
      <button
        onClick={() => toolbar.onNavigate('TODAY')}
        className="px-5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl font-bold text-sm transition-all flex items-center gap-2"
      >
        <CalendarIcon size={16} />
        Hoje
      </button>
      <div className="flex gap-1 bg-muted/50 rounded-xl p-1 border border-border/50">
        <button
          onClick={() => toolbar.onNavigate('PREV')}
          className="p-2 hover:bg-background rounded-lg text-muted-foreground hover:text-foreground transition-all"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => toolbar.onNavigate('NEXT')}
          className="p-2 hover:bg-background rounded-lg text-muted-foreground hover:text-foreground transition-all"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>

    <h2 className="text-xl font-black text-foreground capitalize tracking-tight">
      {toolbar.label}
    </h2>

    <div className="flex gap-1 bg-muted/50 p-1 rounded-xl border border-border/50">
      {['month', 'week', 'day'].map((view) => (
        <button
          key={view}
          onClick={() => toolbar.onView(view)}
          className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
            toolbar.view === view
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
          }`}
        >
          {view === 'month' ? 'Mês' : view === 'week' ? 'Semana' : 'Dia'}
        </button>
      ))}
    </div>
  </div>
);

const CustomEventCard = ({ event }) => {
  const agendados = event.alunosAgendados?.length || 0;
  const capacidade = event.dadosOriginais?.capacidade || 15;
  const isLotado = agendados >= capacidade;
  const porcentagem = Math.min((agendados / capacidade) * 100, 100);

  return (
    <div
      className="h-full flex flex-col p-1 overflow-hidden relative pointer-events-none"
      title={`${event.title}\nProf: ${event.dadosOriginais?.professores?.nome || 'N/A'}`}
    >
      <div className="flex justify-between items-start gap-1 mb-1.5 shrink-0">
        <div className="font-extrabold text-[11px] leading-tight drop-shadow-sm truncate tracking-tight">
          {event.title}
        </div>
        <span 
          className={`flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-sm shrink-0 ${
            isLotado ? 'bg-destructive text-destructive-foreground' : 'bg-background/60 text-foreground/80'
          }`}
        >
          <Users size={9} />
          {agendados}/{capacidade}
        </span>
      </div>

      <div className="w-full h-1 bg-black/10 rounded-full mb-1.5 shrink-0 overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all duration-500 ${isLotado ? 'bg-destructive' : 'bg-white/80'}`} 
          style={{ width: `${porcentagem}%` }} 
        />
      </div>

      {event.alunosAgendados && event.alunosAgendados.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 gap-[2px]">
          {event.alunosAgendados.slice(0, 2).map((item, idx) => {
            const nome = typeof item === 'string' ? item : item.nome;
            const isLead = typeof item === 'object' && item.isLead;
            
            return (
              <div 
                key={idx} 
                className={`text-[10px] leading-tight flex items-center gap-1.5 font-medium overflow-hidden shrink-0 ${
                  isLead ? 'opacity-100' : 'opacity-90'
                }`}
              >
                {isLead ? (
                  <span className="text-[7px] leading-[1] font-black bg-amber-400/90 text-amber-950 px-1 py-0.5 rounded-[3px] shrink-0">
                    LEAD
                  </span>
                ) : (
                  <div className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0"></div>
                )}
                <span className={`truncate min-w-0 ${isLead ? 'font-bold underline decoration-amber-400/40' : ''}`} title={nome}>
                  {nome}
                </span>
              </div>
            );
          })}

          {event.alunosAgendados.length > 2 && (() => {
            const resto = event.alunosAgendados.slice(2);
            const leadsResto = resto.filter(a => typeof a === 'object' && a.isLead).length;
            
            return (
              <div className="text-[9px] font-bold opacity-75 mt-0.5 shrink-0 truncate">
                + {resto.length} {leadsResto > 0 
                  ? `(${leadsResto} lead${leadsResto > 1 ? 's' : ''})` 
                  : 'aluno(s)'}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

// Objeto estável (escopo de módulo) — evitar recriar a cada render, senão
// anula a memoização interna do react-big-calendar (ver ILU-47).
const CALENDAR_COMPONENTS = { toolbar: CustomToolbar, event: CustomEventCard };

function eventPropGetter(event) {
  const corDB = event.dadosOriginais?.cor || 'laranja';
  const corTema = PALETA_CORES.find((c) => c.id === corDB) || PALETA_CORES[0];
  const agendados = event.alunosAgendados?.length || 0;
  const capacidade = event.dadosOriginais?.capacidade || 15;
  const isLotado = agendados >= capacidade;

  return {
    className: `!rounded-xl transition-all duration-200 border border-white/10 ${isLotado ? 'opacity-85 grayscale-[15%]' : ''}`,
    style: {
      backgroundColor: corTema.bg,
      color: corTema.text,
      borderLeft: `5px solid ${corTema.border}`,
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      cursor: 'pointer',
      overflow: 'hidden',
    },
  };
}

// ILU-47: memoizado para não recalcular a grade inteira a cada render do
// pai (Agenda.jsx tem bastante estado não relacionado — formulários,
// modais — que re-renderiza a cada tecla digitada).
const CalendarioGrade = React.memo(function CalendarioGrade({
  eventos,
  currentDate,
  setCurrentDate,
  currentView,
  setCurrentView,
  handleSelectSlot,
  handleSelectEvent,
  isAdmin = false,
}) {
  return (
    <div className="h-full style-calendar-wrapper">
      <Calendar
        localizer={localizer}
        formats={formatosCalendario}
        culture="pt-BR"
        events={eventos}
        startAccessor="start"
        endAccessor="end"
        date={currentDate}
        onNavigate={setCurrentDate}
        view={currentView}
        onView={setCurrentView}
        selectable={isAdmin}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventPropGetter}
        style={{ height: '100%' }}
        components={CALENDAR_COMPONENTS}
        step={30}
        timeslots={2}
        min={new Date(0, 0, 0, 6, 0, 0)}
        max={new Date(0, 0, 0, 23, 0, 0)}
        scrollToTime={new Date(0, 0, 0, 6, 0, 0)}
      />
    </div>
  );
});

export default CalendarioGrade;