import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, CalendarSearch, ArrowLeftRight, CalendarX2, ChevronLeft } from 'lucide-react';

import Button from '../../../components/ui/Button';
import { ModalConfirmacao } from '../../../components/ui/Modal';
import { showToast } from '../../../components/shared/showToast';
import { agendamentoService } from '../../../services/agendamentoService';
import { alunosService } from '../../../services/alunosService';
import { gradeService } from '../../../services/gradeService';
import { hojeBrasilia } from '../../../lib/utils';
import { normalizarDiaSemana } from '../../../lib/diaSemana';
import {
  turmasFixasDaAluna, turmasParaTroca, proximaDataDaTurma, chaveProximasAgendadas, chaveAulasEmHaver,
} from '../../../lib/buscaAlunoAgenda';

const hora = (h) => String(h ?? '').slice(0, 5);
const diaMes = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const rotuloTurma = (a) => `${a.atividade} de ${normalizarDiaSemana(a.dia_semana)} às ${hora(a.horario)}`;

function Secao({ titulo, children }) {
  return (
    <section className="space-y-3">
      <h4 className="text-xs font-black uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      {children}
    </section>
  );
}

function Linha({ principal, secundario, children }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-foreground">{principal}</p>
        {secundario && <p className="truncate text-xs text-muted-foreground">{secundario}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">{children}</div>
    </li>
  );
}

// Busca de aluno na Agenda: painel lateral com as turmas fixas e as próximas
// aulas agendadas da aluna — ver na agenda, trocar a turma fixa, desmarcar.
export default function PainelAlunoAgenda({ aluno, aulas, matriculasFixas, onVerNaAgenda, onFechar, onAlterado }) {
  const hoje = hojeBrasilia();
  const [turmaTrocando, setTurmaTrocando] = useState(null);
  const [destinoTroca, setDestinoTroca] = useState(null);
  const [aulaDesmarcando, setAulaDesmarcando] = useState(null);

  const { data: agendadas = [], isLoading: carregandoAgendadas } = useQuery({
    queryKey: chaveProximasAgendadas(aluno.id),
    queryFn: () => agendamentoService.listarProximasAgendadas(aluno.id, hoje),
  });

  const { data: emHaver } = useQuery({
    queryKey: chaveAulasEmHaver(aluno.id),
    queryFn: () => alunosService.listarFaltasPendentesReposicao(aluno.id),
  });

  const fixas = useMemo(
    () => turmasFixasDaAluna(aulas, matriculasFixas, aluno.id),
    [aulas, matriculasFixas, aluno.id],
  );

  const opcoesTroca = useMemo(
    () => (turmaTrocando ? turmasParaTroca(aulas, turmaTrocando, matriculasFixas, aluno.id, hoje) : []),
    [aulas, turmaTrocando, matriculasFixas, aluno.id, hoje],
  );

  async function confirmarTroca() {
    try {
      await gradeService.trocarTurmaFixa({
        alunoId: aluno.id, aulaAntigaId: turmaTrocando.id, aulaNovaId: destinoTroca.id,
      });
      showToast.success('Horário trocado!');
      setTurmaTrocando(null);
      onAlterado();
    } catch (err) {
      console.error('[PainelAlunoAgenda] trocarTurmaFixa:', err);
      showToast.error(err?.message || 'Erro ao trocar o horário.');
    } finally {
      setDestinoTroca(null);
    }
  }

  async function confirmarDesmarcar() {
    try {
      await agendamentoService.cancelarAgendamento(aulaDesmarcando.id);
      showToast.success('Aula desmarcada. Ela fica como aula em haver.');
      onAlterado();
    } catch (err) {
      console.error('[PainelAlunoAgenda] cancelarAgendamento:', err);
      showToast.error('Erro ao desmarcar a aula.');
    } finally {
      setAulaDesmarcando(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Fechar painel" className="absolute inset-0 bg-black/30" onClick={onFechar} />
      <aside
        role="dialog"
        aria-label={`Horários de ${aluno.nome_completo}`}
        className="relative flex h-full w-full max-w-md flex-col gap-6 overflow-y-auto border-l border-border bg-card p-6 shadow-xl animate-in slide-in-from-right duration-200"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-foreground">{aluno.nome_completo}</h3>
            <p className="text-sm text-muted-foreground">
              Aulas em haver: <span className="font-bold text-foreground">{emHaver ? emHaver.length : '—'}</span>
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onFechar} aria-label="Fechar">
            <X size={18} />
          </Button>
        </header>

        {turmaTrocando ? (
          <Secao titulo={`Trocar ${rotuloTurma(turmaTrocando)} por`}>
            <Button type="button" variant="ghost" size="sm" onClick={() => setTurmaTrocando(null)}>
              <ChevronLeft size={16} /> Voltar
            </Button>
            {opcoesTroca.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma outra turma desta modalidade.</p>
            ) : (
              <ul className="space-y-2">
                {opcoesTroca.map((a) => (
                  <Linha
                    key={a.id}
                    principal={`${normalizarDiaSemana(a.dia_semana)} às ${hora(a.horario)}`}
                    secundario={`${a.atividade} · ${a.ocupados}/${a.capacidade ?? '—'}${a.lotada ? ' · Lotada' : ''}`}
                  >
                    <Button type="button" variant="outline" size="sm" onClick={() => setDestinoTroca(a)}>
                      Escolher
                    </Button>
                  </Linha>
                ))}
              </ul>
            )}
          </Secao>
        ) : (
          <>
            <Secao titulo="Turmas fixas">
              {fixas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma turma fixa.</p>
              ) : (
                <ul className="space-y-2">
                  {fixas.map((a) => {
                    const proxima = proximaDataDaTurma(a, hoje);
                    return (
                      <Linha
                        key={a.id}
                        principal={`${normalizarDiaSemana(a.dia_semana)} às ${hora(a.horario)}`}
                        secundario={[a.atividade, a.professores?.nome].filter(Boolean).join(' · ')}
                      >
                        <Button
                          type="button" variant="ghost" size="sm" disabled={!proxima}
                          onClick={() => onVerNaAgenda({ aulaId: a.id, data: proxima })}
                          title="Ver na agenda"
                        >
                          <CalendarSearch size={16} />
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setTurmaTrocando(a)}>
                          <ArrowLeftRight size={16} /> Trocar horário
                        </Button>
                      </Linha>
                    );
                  })}
                </ul>
              )}
            </Secao>

            <Secao titulo="Próximas aulas agendadas">
              {carregandoAgendadas ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : agendadas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma aula agendada.</p>
              ) : (
                <ul className="space-y-2">
                  {agendadas.map((p) => (
                    <Linha
                      key={p.id}
                      principal={`${diaMes(p.data_aula)} às ${hora(p.agenda?.horario)}`}
                      secundario={p.agenda?.atividade}
                    >
                      <Button
                        type="button" variant="ghost" size="sm" title="Ver na agenda"
                        onClick={() => onVerNaAgenda({ aulaId: p.aula_id, data: p.data_aula })}
                      >
                        <CalendarSearch size={16} />
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setAulaDesmarcando(p)}>
                        <CalendarX2 size={16} /> Desmarcar
                      </Button>
                    </Linha>
                  ))}
                </ul>
              )}
            </Secao>
          </>
        )}
      </aside>

      <ModalConfirmacao
        isOpen={!!destinoTroca}
        onClose={() => setDestinoTroca(null)}
        onConfirm={confirmarTroca}
        titulo="Trocar horário"
        mensagem={destinoTroca && turmaTrocando
          ? `Trocar ${rotuloTurma(turmaTrocando)} por ${normalizarDiaSemana(destinoTroca.dia_semana)} às ${hora(destinoTroca.horario)}?${destinoTroca.lotada ? ' Esta turma está lotada.' : ''}`
          : ''}
        textoConfirmar="Trocar"
        tipo={destinoTroca?.lotada ? 'warning' : 'info'}
      />
      <ModalConfirmacao
        isOpen={!!aulaDesmarcando}
        onClose={() => setAulaDesmarcando(null)}
        onConfirm={confirmarDesmarcar}
        titulo="Desmarcar aula"
        mensagem={aulaDesmarcando
          ? `Desmarcar a aula de ${diaMes(aulaDesmarcando.data_aula)} às ${hora(aulaDesmarcando.agenda?.horario)}? Ela fica como aula em haver.`
          : ''}
        textoConfirmar="Desmarcar"
        tipo="warning"
      />
    </div>
  );
}
