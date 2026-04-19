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
  agendaTimeRangeFormat: ({ start, end }, culture, loc) => `${loc.format(start, 'HH:mm', culture)} - ${loc.format(end, 'HH:mm', culture)}`,
  dayHeaderFormat: 'EEEE, dd/MM',
  dayRangeHeaderFormat: ({ start, end }, culture, loc) => `${loc.format(start, 'dd/MM', culture)} - ${loc.format(end, 'dd/MM', culture)}`,
};

const CustomToolbar = (toolbar) => (
  <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
    <div className="flex items-center gap-2">
      <button onClick={() => toolbar.onNavigate('TODAY')} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm transition-colors">Hoje</button>
      <div className="flex gap-1 bg-gray-50 rounded-xl p-1 border border-gray-100">
        <button onClick={() => toolbar.onNavigate('PREV')} className="p-2 hover:bg-white rounded-lg text-gray-500 shadow-sm"><ChevronLeft size={18}/></button>
        <button onClick={() => toolbar.onNavigate('NEXT')} className="p-2 hover:bg-white rounded-lg text-gray-500 shadow-sm"><ChevronRight size={18}/></button>
      </div>
    </div>
    <h2 className="text-lg font-black text-gray-800 capitalize tracking-wide">{toolbar.label}</h2>
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
      {['month', 'week', 'day'].map(view => (
        <button key={view} onClick={() => toolbar.onView(view)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${toolbar.view === view ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          {view === 'month' ? 'Mês' : view === 'week' ? 'Semana' : 'Dia'}
        </button>
      ))}
    </div>
  </div>
);

const CustomEventCard = ({ event }) => (
  <div className="h-full flex flex-col overflow-hidden relative pointer-events-none">
    <div className="font-bold text-[11px] leading-tight mb-1 shrink-0">{event.title}</div>
    {event.alunosAgendados && event.alunosAgendados.length > 0 && (
      <div className="flex flex-col gap-[2px] mt-1 overflow-hidden">
        {event.alunosAgendados.slice(0, 3).map((aluno, idx) => (
          <div key={idx} className="text-[9px] bg-white/50 px-1 rounded truncate flex items-center gap-1 font-medium">
            <div className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0"></div>{aluno.split(' ')[0]}
          </div>
        ))}
        {event.alunosAgendados.length > 3 && <div className="text-[9px] bg-white/70 font-bold px-1 rounded text-center mt-[2px] shrink-0">+ {event.alunosAgendados.length - 3} alunos</div>}
      </div>
    )}
  </div>
);

function eventPropGetter(event) {
  const corDB = event.dadosOriginais.cor || 'laranja';
  const corTema = PALETA_CORES.find(c => c.id === corDB) || PALETA_CORES[0];
  return {
    style: {
      backgroundColor: corTema.bg, color: corTema.text, border: '1px solid white', borderLeft: `5px solid ${corTema.border}`,
      borderRadius: '6px', padding: '2px 6px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', cursor: 'pointer'
    }
  };
}

export default function CalendarioGrade({ eventos, currentDate, setCurrentDate, currentView, setCurrentView, handleSelectSlot, handleSelectEvent }) {
  return (
    <div className="h-full style-calendar-wrapper">
       <style dangerouslySetInnerHTML={{__html: `
          .rbc-calendar { font-family: inherit; }
          .rbc-header { padding: 12px 0; font-weight: 900; color: #4b5563; text-transform: uppercase; font-size: 11px; border-bottom: 2px solid #f3f4f6; }
          .rbc-today { background-color: #fffaf5; }
          .rbc-time-view { border-radius: 16px; border-color: #f3f4f6; border-top: 1px solid #f3f4f6; }
          .rbc-timeslot-group { border-color: #f3f4f6; min-height: 60px; }
          .rbc-time-content { border-top: 2px solid #f3f4f6; }
          .rbc-time-gutter .rbc-timeslot-group { font-size: 11px; font-weight: bold; color: #9ca3af; }
          @media (max-width: 768px) {
            .rbc-calendar { min-width: 600px; } 
            .style-calendar-wrapper { overflow-x: auto; padding-bottom: 20px; } 
            .rbc-time-header-content { font-size: 10px; }
            .rbc-event { padding: 1px 2px !important; }
            .rbc-toolbar { flex-direction: column; gap: 1rem; align-items: stretch !important; }
            .rbc-toolbar h2 { text-align: center; font-size: 1.1rem; }
          }
       `}} />
      <Calendar
        localizer={localizer} formats={formatosCalendario} culture="pt-BR"
        events={eventos} startAccessor="start" endAccessor="end"
        date={currentDate} onNavigate={setCurrentDate}
        view={currentView} onView={setCurrentView}
        selectable={true} onSelectSlot={handleSelectSlot} onSelectEvent={handleSelectEvent}
        eventPropGetter={eventPropGetter} style={{ height: '100%' }}
        components={{ toolbar: CustomToolbar, event: CustomEventCard }}
        step={30} timeslots={2} min={new Date(0, 0, 0, 6, 0, 0)} max={new Date(0, 0, 0, 23, 0, 0)} scrollToTime={new Date(0, 0, 0, 6, 0, 0)}
      />
    </div>
  );
}