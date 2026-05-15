import React from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users } from 'lucide-react';
import { PALETA_CORES } from '../../../lib/constants';
import 'react-big-calendar/lib/css/react-big-calendar.css';

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

export default function CalendarioGrade({
  eventos,
  currentDate,
  setCurrentDate,
  currentView,
  setCurrentView,
  handleSelectSlot,
  handleSelectEvent,
}) {
  return (
    <div className="h-full style-calendar-wrapper">
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .rbc-calendar { font-family: inherit; }
          .rbc-header {
            padding: 16px 0;
            font-weight: 800;
            color: hsl(var(--muted-foreground));
            text-transform: capitalize;
            font-size: 13px;
            border-bottom: 1px solid hsl(var(--border) / 0.5) !important;
          }
          .rbc-header + .rbc-header { border-left: 1px dashed hsl(var(--border) / 0.3); }
          .rbc-today { background-color: hsl(var(--primary-soft) / 0.3); }
          .rbc-time-view {
            border-radius: calc(var(--radius) + 12px);
            border: 1px solid hsl(var(--border) / 0.5);
            background-color: hsl(var(--card));
          }
          .rbc-timeslot-group {
            border-color: hsl(var(--border) / 0.3);
            min-height: 85px; 
          }
          .rbc-time-slot { border-color: hsl(var(--border) / 0.2); }
          .rbc-time-gutter .rbc-timeslot-group {
            font-size: 11px;
            font-weight: 700;
            color: hsl(var(--muted-foreground));
            padding-right: 8px;
          }
          .rbc-month-view {
            border: 1px solid hsl(var(--border) / 0.5);
            border-radius: calc(var(--radius) + 12px);
            overflow: hidden;
            background-color: hsl(var(--card));
          }
          .rbc-off-range-bg { background-color: hsl(var(--muted) / 0.3); }
          .rbc-date-cell { color: hsl(var(--foreground)); font-weight: 800; padding: 8px; font-size: 12px; }
          .rbc-event-content { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
          .rbc-toolbar { display: none; }
          @media (max-width: 768px) {
            .rbc-calendar { min-width: 700px; }
            .style-calendar-wrapper { overflow-x: auto; padding-bottom: 20px; }
          }
        `,
        }}
      />
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
        selectable={true}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventPropGetter}
        style={{ height: '100%' }}
        components={{ toolbar: CustomToolbar, event: CustomEventCard }}
        step={30}
        timeslots={2}
        min={new Date(0, 0, 0, 6, 0, 0)}
        max={new Date(0, 0, 0, 23, 0, 0)}
        scrollToTime={new Date(0, 0, 0, 6, 0, 0)}
      />
    </div>
  );
}