import React from 'react';
import { Dumbbell, Music, Palette } from 'lucide-react';
import { DIAS_SEMANA, PALETA_CORES } from '../../../lib/constants';
import Button from '../../../components/ui/Button';
import Input, { Label } from '../../../components/ui/Input';

export default function ModalNovaAula({
  novaAula, setNovaAula, modalidades, professores, savingAula, salvarAula
}) {
  return (
    <form onSubmit={salvarAula} className="space-y-4 pt-2">
      <div className="flex bg-muted p-1 rounded-2xl mb-2 border border-border">
        <button
          type="button"
          onClick={() => setNovaAula({...novaAula, ehRecorrente: true, dataEspecifica: ''})}
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${novaAula.ehRecorrente ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Aula Recorrente
        </button>
        <button
          type="button"
          onClick={() => setNovaAula({...novaAula, ehRecorrente: false})}
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${!novaAula.ehRecorrente ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Evento Único
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'funcional' ? 'border-warning bg-warning-soft text-warning' : 'border-border text-muted-foreground hover:bg-subtle'}`}>
          <input type="radio" name="espaco" className="hidden" checked={novaAula.espaco === 'funcional'} onChange={() => setNovaAula({...novaAula, espaco: 'funcional'})} />
          <Dumbbell size={18} /> <span className="font-bold text-xs uppercase">Funcional</span>
        </label>
        <label className={`border-2 p-3 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-all ${novaAula.espaco === 'danca' ? 'border-purple bg-purple-soft text-purple' : 'border-border text-muted-foreground hover:bg-subtle'}`}>
          <input type="radio" name="espaco" className="hidden" checked={novaAula.espaco === 'danca'} onChange={() => setNovaAula({...novaAula, espaco: 'danca'})} />
          <Music size={18} /> <span className="font-bold text-xs uppercase">Dança</span>
        </label>
      </div>

      {novaAula.ehRecorrente ? (
        <Input
          as="select"
          required
          value={novaAula.modalidadeId || ''}
          onChange={e => {
            const val = e.target.value;
            if (!val) return;
            const mod = modalidades.find(m => String(m.id) === String(val));
            setNovaAula({ ...novaAula, modalidadeId: mod.id, atividade: mod.nome, professorId: mod.professor_id || '' });
          }}
        >
          <option value="">Modalidade Base...</option>
          {modalidades.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Input>
      ) : (
        <Input
          placeholder="Nome do Evento"
          required
          value={novaAula.atividade}
          onChange={e => setNovaAula({...novaAula, atividade: e.target.value, modalidadeId: ''})}
        />
      )}

      {novaAula.espaco === 'danca' && (
        <Input
          type="number"
          placeholder="Valor por aluno (R$) - Opcional"
          value={novaAula.valorPorAluno}
          onChange={e => setNovaAula({...novaAula, valorPorAluno: e.target.value})}
        />
      )}

      <div>
        <Label className="text-[10px] font-black text-muted-foreground uppercase flex items-center gap-2 mb-2">
          <Palette size={14}/> Cor no Calendário
        </Label>
        <div className="flex flex-wrap gap-2">
          {PALETA_CORES.map(c => (
            <button
              type="button"
              key={c.id}
              title={c.id}
              onClick={() => setNovaAula({...novaAula, cor: c.id})}
              className={`w-10 h-10 rounded-full border-4 transition-all hover:scale-110 ${novaAula.cor === c.id ? 'scale-110 shadow-md' : 'border-transparent'}`}
              style={{ backgroundColor: c.bg, borderColor: novaAula.cor === c.id ? c.border : 'transparent' }}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {novaAula.ehRecorrente ? (
          <Input as="select" value={novaAula.diaSemana} onChange={e => setNovaAula({...novaAula, diaSemana: e.target.value})}>
            {DIAS_SEMANA.map(d => <option key={d.valor} value={d.valor}>{d.label}</option>)}
          </Input>
        ) : (
          <Input type="date" required value={novaAula.dataEspecifica} onChange={e => setNovaAula({...novaAula, dataEspecifica: e.target.value})} />
        )}
        <Input type="time" required value={novaAula.horario} onChange={e => setNovaAula({...novaAula, horario: e.target.value})} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Input as="select" required value={novaAula.professorId} onChange={e => setNovaAula({...novaAula, professorId: e.target.value})}>
            <option value="">Selecione o Professor</option>
            {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Input>
        </div>
        <Input
          type="number"
          placeholder="Vagas"
          title="Capacidade Máxima de Alunos"
          className="text-center font-bold"
          required
          value={novaAula.capacidade}
          onChange={e => setNovaAula({...novaAula, capacidade: e.target.value})}
        />
      </div>

      <div className="pt-2">
        <Button type="submit" variant="brand" size="lg" fullWidth loading={savingAula}>
          {novaAula.id ? 'Salvar Alterações' : 'Salvar na Grade'}
        </Button>
      </div>
    </form>
  );
}