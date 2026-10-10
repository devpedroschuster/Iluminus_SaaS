import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { areaAlunoService } from '../../services/areaAlunoService';
import { showToast } from '../shared/showToast';
import { ModalConfirmacao } from '../ui/Modal';
import {
  montarDias, aulasDoDia, consumoDaSemana, acaoDoCartao, avisoDoPlano, rotuloStatus,
  nomeProfessor, diasComAula, formatarDiaMes, inicioDaSemana, somarDias,
} from '../../lib/agendaAluno';

const QUERY_AULAS_ALUNO = ['aulas-aluno'];

// Aba "Agendar Aulas" da Área do Aluno (ILU-78/79/80). Tudo vem de
// listar_aulas_aluno: o servidor decide o que pode ser agendado/cancelado e
// devolve o motivo; a tela só exibe.
export default function AbaAgendarAulas({ onFalarComRecepcao }) {
  const queryClient = useQueryClient();
  const [diaEscolhido, setDiaEscolhido] = useState(null);
  const [processando, setProcessando] = useState(null); // `${aula_id}-${data}`
  const [aulaParaCancelar, setAulaParaCancelar] = useState(null);

  const { data: dados, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_AULAS_ALUNO,
    queryFn: () => areaAlunoService.listarAulas(),
  });

  const dias = useMemo(() => (dados?.hoje ? montarDias(dados.hoje) : []), [dados?.hoje]);
  const marcados = useMemo(() => diasComAula(dados?.aulas), [dados?.aulas]);

  const executar = async (aula, acao) => {
    setProcessando(`${aula.aula_id}-${aula.data}`);
    try {
      if (acao === 'agendar') {
        await areaAlunoService.agendar(aula.aula_id, aula.data);
        showToast.success('Vaga garantida!');
      } else {
        await areaAlunoService.cancelar(aula.aula_id, aula.data);
        showToast.success('Aula cancelada. A vaga foi liberada.');
      }
    } catch (error) {
      showToast.error(error.message);
    } finally {
      setProcessando(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_AULAS_ALUNO });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-gray-400" /></div>;
  }
  if (isError || !dados) {
    return (
      <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <AlertCircle className="mx-auto text-gray-300 mb-3" size={40} />
        <p className="text-gray-800 font-bold text-lg mb-1">Não foi possível carregar as aulas</p>
        <button className="btn btn-outline btn-sm mt-3" onClick={() => refetch()}>Tentar de novo</button>
      </div>
    );
  }

  const diaAtivo = dias.some((d) => d.data === diaEscolhido) ? diaEscolhido : dias[0]?.data;
  const aulas = aulasDoDia(dados.aulas, diaAtivo);
  const feriado = dados.feriados.find((f) => f.data === diaAtivo);
  const consumo = consumoDaSemana(dados.consumo, diaAtivo);
  const semana = inicioDaSemana(diaAtivo);
  const aviso = avisoDoPlano(dados.plano, dados.hoje);
  const rotuloDia = (data) => dias.find((d) => d.data === data)?.rotulo ?? '';

  return (
    <>
      {aviso && (
        <div className={`mb-6 p-4 rounded-2xl border ${aviso.tom === 'bloqueio' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <p className="font-bold text-sm">{aviso.texto}</p>
          {aviso.tom === 'bloqueio' && (
            <button className="btn btn-wa btn-sm mt-3" onClick={() => onFalarComRecepcao('Olá! Quero renovar meu plano para voltar a agendar aulas.')}>
              💬 Falar com a recepção
            </button>
          )}
        </div>
      )}

      {consumo.length > 0 && (
        <div className="mb-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[11px] font-extrabold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-400"></span>
            Sua semana · {formatarDiaMes(semana)} a {formatarDiaMes(somarDias(semana, 6))}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {consumo.map((c) => {
              const pct = c.livre ? 0 : Math.min((c.uso / c.limite) * 100, 100);
              return (
                <div key={c.area} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                  <p className="font-bold text-gray-700 text-sm">{c.area}</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">
                    {c.livre ? 'Sem limite' : <>Usado: <span className="text-primary font-bold text-sm">{c.uso}</span> / {c.limite}</>}
                  </p>
                  {!c.livre && (
                    <div className="bg-gray-200 h-1.5 rounded-full overflow-hidden mt-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'var(--err)' : 'var(--pri)' }}></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="day-tabs" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }}>
        {dias.map((d) => (
          <button
            key={d.data}
            className={`day-tab ${diaAtivo === d.data ? 'active' : ''}`}
            onClick={() => setDiaEscolhido(d.data)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '8px 16px', flexShrink: 0 }}
          >
            <span style={{ fontSize: '13px' }}>{d.rotulo}</span>
            <span style={{ fontSize: '10px', opacity: 0.8 }}>{d.diaMes}</span>
            <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '3px', background: marcados.has(d.data) ? 'currentColor' : 'transparent' }}></span>
          </button>
        ))}
      </div>

      <div id="class-list">
        {!dados.plano && aulas.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <AlertCircle className="mx-auto text-gray-300 mb-3" size={40} />
            <p className="text-gray-800 font-bold text-lg mb-1">Sem plano ativo</p>
            <p className="text-gray-500 text-sm">Você precisa ter um plano para agendar aulas. Fale com a recepção.</p>
          </div>
        ) : feriado ? (
          <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <span style={{ fontSize: '40px' }}>⛔</span>
            <p className="text-gray-800 font-bold text-lg mb-1 mt-3">{feriado.descricao}</p>
            <p className="text-gray-500 text-sm">Não há aulas neste dia. Escolha outra data.</p>
          </div>
        ) : aulas.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <p className="text-gray-500 font-medium">Nenhuma aula da sua matrícula neste dia.</p>
          </div>
        ) : (
          aulas.map((aula) => (
            <CartaoAula
              key={`${aula.aula_id}-${aula.data}`}
              aula={aula}
              ocupado={processando === `${aula.aula_id}-${aula.data}`}
              onAgendar={() => executar(aula, 'agendar')}
              onCancelar={() => setAulaParaCancelar(aula)}
            />
          ))
        )}
      </div>

      <ModalConfirmacao
        isOpen={!!aulaParaCancelar}
        onClose={() => setAulaParaCancelar(null)}
        onConfirm={() => executar(aulaParaCancelar, 'cancelar')}
        titulo="Cancelar aula?"
        mensagem={aulaParaCancelar
          ? `Cancelar ${aulaParaCancelar.atividade} de ${rotuloDia(aulaParaCancelar.data)} ${formatarDiaMes(aulaParaCancelar.data)} às ${aulaParaCancelar.horario}? A vaga é liberada e não conta na sua semana.`
          : ''}
        textoConfirmar="Cancelar aula"
        textoCancelar="Voltar"
        tipo="warning"
      />
    </>
  );
}

function CartaoAula({ aula, ocupado, onAgendar, onCancelar }) {
  const acao = acaoDoCartao(aula);
  const status = rotuloStatus(aula.meu_status);
  const marcado = aula.meu_status === 'agendado' || aula.meu_status === 'fixo';
  const lotada = aula.ocupacao >= aula.capacidade;
  const pct = aula.capacidade > 0 ? Math.min((aula.ocupacao / aula.capacidade) * 100, 100) : 100;

  // No celular a ação vai para uma linha própria: lado a lado com o horário e
  // o nome, o botão ficava cortado na borda do cartão.
  return (
    <div className={`class-card anim-fade-up flex-wrap sm:flex-nowrap ${marcado ? 'booked' : ''}`}>
      <div className="class-time-block">
        <div className="class-time">{aula.horario}</div>
        <div className={`class-space ${aula.area === 'Dança' ? 'danca' : 'funcional'}`}>{aula.area}</div>
      </div>
      <div className="class-info">
        <div className="class-name">{aula.atividade}</div>
        <div className="class-teacher">{nomeProfessor(aula)}</div>
        <div className="capacity-bar-row">
          <span className={`capacity-label ${lotada && !marcado ? 'last-spot' : ''}`}>
            {aula.ocupacao}/{aula.capacidade} vagas ocupadas
          </span>
          <div className="capacity-bar-track">
            <div className="capacity-bar-fill" style={{ width: `${pct}%`, background: marcado ? 'var(--ok)' : (lotada ? 'var(--err)' : 'var(--pri)') }}></div>
          </div>
        </div>
      </div>
      <div className="class-action w-full sm:w-auto" style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        {acao.tipo === 'agendar' && (
          <button onClick={onAgendar} disabled={ocupado} className="btn-book reserve">
            {ocupado ? <RefreshCw className="animate-spin text-white" size={16} /> : acao.texto}
          </button>
        )}
        {acao.tipo === 'cancelar' && (
          <button onClick={onCancelar} disabled={ocupado} className="btn-book cancel">
            {ocupado ? <RefreshCw className="animate-spin" size={16} /> : acao.texto}
          </button>
        )}
        {acao.tipo === 'info' && acao.texto && (
          <div className="text-[11px] font-bold text-gray-500 text-center" style={{ maxWidth: '160px' }}>{acao.texto}</div>
        )}
        {status && (
          <div className="booked-check flex items-center gap-1">
            {marcado && <CheckCircle2 size={14} />} {status}
          </div>
        )}
      </div>
    </div>
  );
}
