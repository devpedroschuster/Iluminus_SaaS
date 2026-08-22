import React, { useState, useEffect } from 'react';
import { RefreshCw, Trash2, CalendarCheck } from 'lucide-react';
import { ModalConfirmacao } from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Input, { Label } from '../../../components/ui/Input';
import { alunosService } from '../../../services/alunosService';

function formatarDataCurta(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

// ILU-8: ao marcar presença numa aula avulsa, permite indicar que esta
// aula é reposição de uma falta específica do aluno (dentro do período
// do plano vigente e que ainda não foi reposta).
function SeletorReposicao({ aluno, marcando, onConfirmar }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [faltas, setFaltas] = useState([]);
  const [selecionada, setSelecionada] = useState('');

  useEffect(() => {
    if (!aberto || !aluno.aluno_id) return;
    let cancelado = false;
    setCarregando(true);
    alunosService.listarFaltasPendentesReposicao(aluno.aluno_id)
      .then(lista => { if (!cancelado) setFaltas(lista); })
      .catch(() => { if (!cancelado) setFaltas([]); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, aluno.aluno_id]);

  if (!aberto) {
    return (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<CalendarCheck size={14} />}
        onClick={() => setAberto(true)}
      >
        Reposição?
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="text-xs font-bold border border-border rounded-lg px-2 py-1.5 bg-card text-foreground max-w-[160px]"
        value={selecionada}
        onChange={e => setSelecionada(e.target.value)}
        disabled={carregando}
      >
        <option value="">
          {carregando ? 'Carregando...' : 'Falta a repor'}
        </option>
        {faltas.map(f => (
          <option key={f.id} value={f.id}>
            {formatarDataCurta(f.data_aula)} · {f.agenda?.atividade ?? 'Aula'}
            {f.status === 'cancelado' ? ' (avisou)' : ''}
          </option>
        ))}
      </select>
      <Button
        variant="success"
        size="sm"
        disabled={!selecionada}
        loading={marcando}
        onClick={() => onConfirmar(Number(selecionada))}
      >
        Confirmar
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
        Cancelar
      </Button>
    </div>
  );
}

export default function ModalListaPresenca({
  aulaParaLista, dataLista, setDataLista, listaPresenca, loadingLista,
  handleRegistrarFalta, handleDesfazerFalta,
  handleMarcarPresenca, handleDesmarcarPresenca, marcandoId,
  alunoParaRemover, solicitarRemocao, confirmarRemocao, cancelarRemocao, refreshKey,
  isAdmin,
}) {
  if (!aulaParaLista) return null;
  return (
    <div className="space-y-4 pt-2 min-h-[300px]">
      <div className="bg-muted p-4 rounded-xl border border-border">
        <h4 className="font-black text-foreground">{aulaParaLista.atividade}</h4>
        <div className="mt-3">
          <Label className="block text-[10px] font-black text-muted-foreground uppercase mb-1">Data da Aula</Label>
          <Input 
            type="date" 
            value={dataLista} 
            onChange={e => setDataLista(e.target.value)} 
            className="bg-card"
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between items-center mb-3">
          <h5 className="font-bold text-sm text-foreground">Alunos da Turma</h5>
        </div>
        {loadingLista ? (
          <div className="flex justify-center p-6"><RefreshCw className="animate-spin text-muted-foreground" size={24} /></div>
        ) : listaPresenca.length === 0 ? (
          <div className="text-center p-6 bg-muted/50 rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground font-medium">Ninguém matriculado ou agendado ainda.</p>
          </div>
        ) : (
          <ul className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {listaPresenca.map(aluno => {
              const ausente = aluno.status === 'falta' || aluno.status === 'cancelado';
              return (
              <li key={`${aluno.tipo}-${aluno.aluno_id || aluno.nome}`} className={`p-3 border rounded-xl flex justify-between items-center transition-all ${ausente ? 'bg-destructive-soft border-destructive/30 opacity-70' : 'bg-card border-border shadow-sm'}`}>
                <div>
                  <span className={`font-bold text-sm ${ausente ? 'text-destructive line-through' : 'text-foreground'}`}>
                    {aluno.nome}
                  </span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {aluno.tipo === 'fixo' && <span className="text-[9px] bg-purple-soft text-purple px-2 py-0.5 rounded font-black uppercase tracking-wider">Fixo</span>}
                    {aluno.tipo === 'avulso' && <span className="text-[9px] bg-info-soft text-info px-2 py-0.5 rounded font-black uppercase tracking-wider">Avulso</span>}
                    {aluno.tipo === 'experimental' && ( <span className="ml-1.5 text-[10px] font-black bg-warning/20 text-warning px-1.5 py-0.5 rounded-full border border-warning/30">LEAD</span>
)}
                    {aluno.status === 'falta' && <span className="text-[9px] bg-destructive-soft text-destructive px-2 py-0.5 rounded font-black uppercase tracking-wider">Falta (sem aviso)</span>}
                    {aluno.status === 'cancelado' && <span className="text-[9px] bg-destructive-soft text-destructive px-2 py-0.5 rounded font-black uppercase tracking-wider">Avisou que não vem</span>}
                    {aluno.status === 'presente' && <span className="text-[9px] bg-success-soft text-success px-2 py-0.5 rounded font-black uppercase tracking-wider">Presente</span>}
                  </div>
                </div>
                <div className="ml-2 flex gap-2">
                  {aluno.tipo === 'experimental' ? (
                    isAdmin ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        leftIcon={<Trash2 size={14} />}
                        onClick={() => solicitarRemocao(aluno.id_relacao, aluno.tipo)}
                      >
                        Remover
                      </Button>
                    ) : null
                  ) : ausente ? (
                    <Button variant="secondary" size="sm" onClick={() => handleDesfazerFalta(aluno)}>
                      Desfazer
                    </Button>
                  ) : aluno.status === 'presente' ? (
                    isAdmin && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={marcandoId === (aluno.id_relacao || aluno.aluno_id)}
                        onClick={() => handleDesmarcarPresenca(aluno)}
                      >
                        Desmarcar
                      </Button>
                    )
                  ) : (
                    <>
                      {isAdmin && (
                        <Button
                          variant="success"
                          size="sm"
                          loading={marcandoId === (aluno.id_relacao || aluno.aluno_id)}
                          onClick={() => handleMarcarPresenca(aluno)}
                        >
                          Marcar Presente
                        </Button>
                      )}
                      {isAdmin && aluno.tipo === 'avulso' && aluno.aluno_id && (
                        <SeletorReposicao
                          aluno={aluno}
                          marcando={marcandoId === (aluno.id_relacao || aluno.aluno_id)}
                          onConfirmar={(reposicaoDeId) => handleMarcarPresenca(aluno, reposicaoDeId)}
                        />
                      )}
                      <Button variant="destructive" size="sm" onClick={() => handleRegistrarFalta(aluno)}>
                        Informar Falta
                      </Button>
                      {aluno.tipo === 'avulso' && isAdmin && aluno.id_relacao && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Trash2 size={14} />}
                          onClick={() => solicitarRemocao(aluno.id_relacao, aluno.tipo)}
                        >
                          Remover
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>
      <ModalConfirmacao
        isOpen={!!alunoParaRemover}
        onClose={cancelarRemocao}
        onConfirm={confirmarRemocao}
        titulo="Remover Aluno"
        mensagem="Tem certeza que deseja remover este aluno desta lista de presença?"
        tipo="danger"
      />
    </div>
  );
}