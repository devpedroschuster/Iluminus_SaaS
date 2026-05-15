import React from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-card border border-border rounded-2xl p-3 shadow-sm">
    <div className="flex items-center gap-2">
      <button
        onClick={() => toolbar.onNavigate('TODAY')}
        className="px-4 py-2 bg-muted hover:bg-subtle text-foreground rounded-xl font-bold text-sm transition-colors"
      >
        Hoje
      </button>
      <div className="flex gap-1 bg-muted rounded-xl p-1 border border-border">
        <button
          onClick={() => toolbar.onNavigate('PREV')}
          className="p-2 hover:bg-card rounded-lg text-muted-foreground shadow-sm transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => toolbar.onNavigate('NEXT')}
          className="p-2 hover:bg-card rounded-lg text-muted-foreground shadow-sm transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>

    <h2 className="text-lg font-black text-foreground capitalize tracking-wide">
      {toolbar.label}
    </h2>

    <div className="flex gap-1 bg-muted p-1 rounded-xl border border-border">
      {['month', 'week', 'day'].map((view) => (
        <button
          key={view}
          onClick={() => toolbar.onView(view)}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            toolbar.view === view
              ? 'bg-card text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {view === 'month' ? 'Mês' : view === 'week' ? 'Semana' : 'Dia'}
        </button>
      ))}
    </div>
  </div>
);

// 🎨 Card da Aula na Grade (Protegido contra Esmagamento Vertical)
const CustomEventCard = ({ event }) => (
  <div
    className="h-full flex flex-col overflow-hidden relative pointer-events-none"
    title={`${event.title}\nProf: ${event.dadosOriginais?.professores?.nome || 'N/A'}`}
  >
    {/* Título com TRUNCATE: Garante que fique em apenas 1 linha para não roubar espaço vertical */}
    <div className="font-bold text-xs leading-tight mb-[2px] shrink-0 drop-shadow-sm truncate">
      {event.title}
    </div>

    {event.alunosAgendados && event.alunosAgendados.length > 0 && (
      // min-h-0 é o segredo do Flexbox para permitir que ele oculte os filhos em vez de esmagá-los
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {event.alunosAgendados.slice(0, 2).map((aluno, idx) => (
          <div
            key={idx}
            className="text-[10px] leading-tight flex items-center gap-1 font-medium overflow-hidden opacity-95 shrink-0"
          >
            <div className="w-1 h-1 rounded-full bg-current opacity-60 shrink-0"></div>
            <span className="truncate min-w-0" title={aluno}>
              {aluno}
            </span>
          </div>
        ))}

        {event.alunosAgendados.length > 2 && (
          <div className="text-[9px] font-bold opacity-80 mt-[1px] shrink-0 truncate">
            + {event.alunosAgendados.length - 2} aluno(s)
          </div>
        )}
      </div>
    )}
  </div>
);

function eventPropGetter(event) {
  const corDB = event.dadosOriginais.cor || 'laranja';
  const corTema = PALETA_CORES.find((c) => c.id === corDB) || PALETA_CORES[0];
  return {
    style: {
      backgroundColor: corTema.bg,
      color: corTema.text,
      border: '1px solid white',
      borderLeft: `4px solid ${corTema.border}`,
      borderRadius: '8px',
      padding: '4px 6px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
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

          /* Cabeçalhos dos dias da semana */
          .rbc-header {
            padding: 12px 0;
            font-weight: 900;
            color: hsl(var(--muted-foreground));
            text-transform: uppercase;
            font-size: 11px;
            border-bottom: 2px solid hsl(var(--border));
          }
          .rbc-header + .rbc-header { border-left: 1px solid hsl(var(--border)); }

          /* Célula do dia atual */
          .rbc-today { background-color: hsl(var(--primary-soft)); }

          /* Vista de tempo (week/day) */
          .rbc-time-view {
            border-radius: calc(var(--radius) + 8px);
            border-color: hsl(var(--border));
            border-top: 1px solid hsl(var(--border));
            background-color: hsl(var(--card));
          }
          .rbc-time-header { border-color: hsl(var(--border)); }
          .rbc-time-header-content { border-left: 1px solid hsl(var(--border)); }

          /* Linhas de timeslot */
          .rbc-timeslot-group {
            border-color: hsl(var(--border));
            min-height: 60px;
          }
          .rbc-time-slot { border-color: hsl(var(--border)); }
          .rbc-time-content { border-top: 2px solid hsl(var(--border)); }

          /* Gutter de horários */
          .rbc-time-gutter .rbc-timeslot-group {
            font-size: 11px;
            font-weight: bold;
            color: hsl(var(--muted-foreground));
          }

          /* Linhas e bordas da grade mensal */
          .rbc-month-view {
            border-color: hsl(var(--border));
            border-radius: calc(var(--radius) + 8px);
            overflow: hidden;
            background-color: hsl(var(--card));
          }
          .rbc-month-row { border-color: hsl(var(--border)); }
          .rbc-day-bg + .rbc-day-bg { border-color: hsl(var(--border)); }
          .rbc-off-range-bg { background-color: hsl(var(--muted)); }

          /* Números dos dias */
          .rbc-date-cell { color: hsl(var(--foreground)); font-weight: 700; }
          .rbc-off-range .rbc-date-cell { color: hsl(var(--muted-foreground)); }

          /* Conteúdo do evento */
          .rbc-event-content { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

          /* Linha de "mais eventos" na vista mensal */
          .rbc-show-more {
            color: hsl(var(--primary));
            font-weight: 700;
            font-size: 11px;
          }

          /* Toolbar nativa (oculta pois usamos custom) */
          .rbc-toolbar { display: none; }

          /* Separador vertical entre colunas de dia */
          .rbc-day-slot .rbc-time-slot { border-color: hsl(var(--border)); }

          /* Responsividade mobile */
          @media (max-width: 768px) {
            .rbc-calendar { min-width: 600px; }
            .style-calendar-wrapper { overflow-x: auto; padding-bottom: 20px; }
            .rbc-time-header-content { font-size: 10px; }
            .rbc-event { padding: 2px 4px !important; }
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