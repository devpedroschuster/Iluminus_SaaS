import React from 'react';
import { Dumbbell, Music, Palette, RefreshCw, CalendarDays, Type } from 'lucide-react';
import { DIAS_SEMANA, PALETA_CORES } from '../../../lib/constants';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

export default function ModalNovaAula({
  novaAula, setNovaAula, modalidades, professores, savingAula, salvarAula
}) {
  const handleModalidadeChange = (e) => {
    const id = e.target.value;
    const mod = modalidades.find(m => m.id === id);
    setNovaAula({
      ...novaAula,
      modalidadeId: id,
      atividade: mod?.nome ?? novaAula.atividade,
      professorId: mod?.professor_id || '',
      capacidade: mod?.capacidade_padrao || 15,
      espaco: mod?.area?.toLowerCase() === 'funcional' ? 'funcional' : 'danca',
      cor: novaAula.cor || (mod?.area === 'Funcional' ? 'amarelo' : 'roxo'),
    });
  };

  const handleTipoChange = (ehRecorrente) => {
    setNovaAula({
      ...novaAula,
      ehRecorrente,
      // Limpa campos exclusivos de cada modo ao trocar
      modalidadeId: '',
      atividade: '',
      professorId: '',
      dataEspecifica: ehRecorrente ? '' : novaAula.dataEspecifica,
    });
  };

  return (
    <form onSubmit={salvarAula} className="space-y-5 pt-2">

      {/* TIPO DE AULA */}
      <div className="flex bg-muted p-1 rounded-2xl border border-border">
        <button
          type="button"
          onClick={() => handleTipoChange(true)}
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${
            novaAula.ehRecorrente
              ? 'bg-card shadow-sm text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Aula Recorrente
        </button>
        <button
          type="button"
          onClick={() => handleTipoChange(false)}
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${
            !novaAula.ehRecorrente
              ? 'bg-card shadow-sm text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Evento Único
        </button>
      </div>

      {novaAula.ehRecorrente ? (
        /* ── CAMPOS EXCLUSIVOS: AULA RECORRENTE ── */
        <>
          {/* Modalidade */}
          <Input
            as="select"
            required
            value={novaAula.modalidadeId || ''}
            onChange={handleModalidadeChange}
          >
            <option value="">Selecione a Modalidade</option>
            {modalidades.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </Input>

          {/* Professor + Vagas */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Input
                as="select"
                required
                value={novaAula.professorId || ''}
                onChange={e => setNovaAula({ ...novaAula, professorId: e.target.value })}
              >
                <option value="">Selecione o Professor</option>
                {professores.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </Input>
            </div>
            <Input
              type="number"
              placeholder="Vagas"
              title="Capacidade Máxima de Alunos"
              className="text-center font-bold"
              required
              min="1"
              value={novaAula.capacidade || ''}
              onChange={e => setNovaAula({ ...novaAula, capacidade: e.target.value })}
            />
          </div>
        </>
      ) : (
        /* ── CAMPOS EXCLUSIVOS: EVENTO ÚNICO ── */
        <>
          {/* Nome livre do evento */}
          <div>
            <label className="text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-1">
              <Type size={14} /> Nome do Evento
            </label>
            <Input
              type="text"
              required
              placeholder="Ex: Reunião de equipe, Workshop, Confraternização..."
              value={novaAula.atividade || ''}
              onChange={e => setNovaAula({ ...novaAula, atividade: e.target.value })}
            />
          </div>
        </>
      )}

      {/* ── ESPAÇO (comum aos dois modos) ── */}
      <div>
        <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Espaço</label>
        <div className="grid grid-cols-2 gap-3">
          <label className={`flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
            novaAula.espaco === 'funcional'
              ? 'bg-warning-soft text-warning border-warning/20 shadow-sm'
              : 'border-border text-muted-foreground hover:bg-subtle'
          }`}>
            <input
              type="radio"
              name="espaco"
              value="funcional"
              className="sr-only"
              checked={novaAula.espaco === 'funcional'}
              onChange={e => setNovaAula({ ...novaAula, espaco: e.target.value })}
            />
            <Dumbbell size={18} /> <span className="font-bold text-sm">Funcional</span>
          </label>
          <label className={`flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
            novaAula.espaco === 'danca'
              ? 'bg-purple-soft text-purple border-purple/20 shadow-sm'
              : 'border-border text-muted-foreground hover:bg-subtle'
          }`}>
            <input
              type="radio"
              name="espaco"
              value="danca"
              className="sr-only"
              checked={novaAula.espaco === 'danca'}
              onChange={e => setNovaAula({ ...novaAula, espaco: e.target.value })}
            />
            <Music size={18} /> <span className="font-bold text-sm">Dança</span>
          </label>
        </div>
      </div>

      {/* ── DATA/DIA E HORÁRIO (comum aos dois modos) ── */}
      <div className="grid grid-cols-2 gap-4">
        {novaAula.ehRecorrente ? (
          <Input
            as="select"
            required
            value={novaAula.diaSemana || ''}
            onChange={e => setNovaAula({ ...novaAula, diaSemana: e.target.value })}
          >
            <option value="">Dia da Semana</option>
            {DIAS_SEMANA.map(d => (
              <option key={d.valor} value={d.valor}>{d.label}</option>
            ))}
          </Input>
        ) : (
          <Input
            type="date"
            required
            value={novaAula.dataEspecifica || ''}
            onChange={e => setNovaAula({ ...novaAula, dataEspecifica: e.target.value })}
          />
        )}
        <Input
          type="time"
          required
          value={novaAula.horario || ''}
          onChange={e => setNovaAula({ ...novaAula, horario: e.target.value })}
        />
      </div>

      {/* ── COR VISUAL (comum aos dois modos) ── */}
      <div>
        <label className="text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-1">
          <Palette size={14} /> Cor na Agenda
        </label>
        <div className="flex flex-wrap gap-2">
          {PALETA_CORES.map(cor => (
            <button
              key={cor.id}
              type="button"
              onClick={() => setNovaAula({ ...novaAula, cor: cor.id })}
              className={`w-8 h-8 rounded-full transition-all flex items-center justify-center border-2 flex-shrink-0 opacity-100 ${
                novaAula.cor === cor.id
                  ? 'border-foreground scale-110 shadow-sm'
                  : 'border-transparent hover:scale-110'
              }`}
              style={{ backgroundColor: cor.border }}
              title={cor.id}
            />
          ))}
        </div>
      </div>

      {/* ── SUBMIT ── */}
      <Button
        type="submit"
        variant="brand"
        disabled={savingAula}
        className="w-full font-black text-lg h-14 mt-4 gap-2"
      >
        {savingAula
          ? <RefreshCw className="animate-spin" size={24} />
          : (novaAula.ehRecorrente ? 'Criar Turma' : 'Agendar Evento')}
      </Button>

    </form>
  );
}