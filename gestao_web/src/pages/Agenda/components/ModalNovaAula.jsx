import React, { useState } from 'react';
import { Dumbbell, Music, Palette, RefreshCw, Type, Clock } from 'lucide-react';
import { DIAS_SEMANA, PALETA_CORES } from '../../../lib/constants';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

const OPCOES_DURACAO = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1h',     value: 60 },
  { label: '1h 30',  value: 90 },
  { label: '2h',     value: 120 },
  { label: 'Outro',  value: 'custom' },
];

const PRESETS = OPCOES_DURACAO.filter(o => o.value !== 'custom').map(o => o.value);

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
      modalidadeId: '',
      atividade: '',
      professorId: '',
      dataEspecifica: ehRecorrente ? '' : novaAula.dataEspecifica,
    });
  };

  const duracaoAtual = novaAula.duracaoMinutos ?? 60;
  const [usandoCustom, setUsandoCustom] = useState(() => !PRESETS.includes(Number(duracaoAtual)));

  const selecaoPreset = usandoCustom ? 'custom' : duracaoAtual;

  const handlePresetChange = (val) => {
    if (val === 'custom') {
      setUsandoCustom(true);
      setNovaAula({ ...novaAula, duracaoMinutos: '' });
    } else {
      setUsandoCustom(false);
      setNovaAula({ ...novaAula, duracaoMinutos: Number(val) });
    }
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
        <>
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

      {/* ESPAÇO */}
      <div>
        <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Espaço</label>
        <div className="grid grid-cols-2 gap-3">
          <label className={`flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
            novaAula.espaco === 'funcional'
              ? 'bg-warning-soft text-warning border-warning/20 shadow-sm'
              : 'border-border text-muted-foreground hover:bg-subtle'
          }`}>
            <input type="radio" name="espaco" value="funcional" className="sr-only"
              checked={novaAula.espaco === 'funcional'}
              onChange={e => setNovaAula({ ...novaAula, espaco: e.target.value })} />
            <Dumbbell size={18} /> <span className="font-bold text-sm">Funcional</span>
          </label>
          <label className={`flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
            novaAula.espaco === 'danca'
              ? 'bg-purple-soft text-purple border-purple/20 shadow-sm'
              : 'border-border text-muted-foreground hover:bg-subtle'
          }`}>
            <input type="radio" name="espaco" value="danca" className="sr-only"
              checked={novaAula.espaco === 'danca'}
              onChange={e => setNovaAula({ ...novaAula, espaco: e.target.value })} />
            <Music size={18} /> <span className="font-bold text-sm">Dança</span>
          </label>
        </div>
      </div>

      {/* DATA/DIA E HORÁRIO */}
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

      {/* DURAÇÃO DA AULA */}
      <div>
        <label className="text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-1">
          <Clock size={14} /> Duração da Aula
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {OPCOES_DURACAO.map(opcao => (
            <button
              key={opcao.value}
              type="button"
              onClick={() => handlePresetChange(opcao.value)}
              className={`px-3 py-2 rounded-xl text-xs font-black uppercase transition-all border ${
                selecaoPreset === opcao.value
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-muted text-muted-foreground border-border hover:bg-subtle'
              }`}
            >
              {opcao.label}
            </button>
          ))}
        </div>
        {usandoCustom && (
          <div className="flex items-center gap-2 mt-2">
            <Input
              type="number"
              min="5"
              max="480"
              step="5"
              placeholder="Ex: 75"
              className="w-32 text-center font-bold"
              value={novaAula.duracaoMinutos}
              onChange={e => setNovaAula({ ...novaAula, duracaoMinutos: Number(e.target.value) || '' })}
              required
            />
            <span className="text-sm text-muted-foreground font-medium">minutos</span>
          </div>
        )}
      </div>

      {/* COR VISUAL */}
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
              className={`w-8 h-8 rounded-full transition-all flex items-center justify-center border-2 flex-shrink-0 ${
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

      {/* SUBMIT */}
      <Button type="submit" variant="brand" disabled={savingAula} className="w-full font-black text-lg h-14 mt-4 gap-2">
        {savingAula ? <RefreshCw className="animate-spin" size={24} /> : (novaAula.ehRecorrente ? 'Criar Turma' : 'Agendar Evento')}
      </Button>
    </form>
  );
}