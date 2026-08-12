import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { agendamentoService } from '../services/agendamentoService';
import {
  QrCode, Search, UserCheck, Calendar, TrendingUp,
  Clock, Award, AlertCircle, Users, CheckCircle2,
  XCircle, Download, BarChart2, Zap, ChevronRight
} from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import { formatarData } from '../lib/utils';
import Modal, { useModal } from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Input, { Label } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Surface from '../components/ui/Surface';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

// ─── helpers puros (fora do componente — sem re-criação a cada render) ───────

function aulaEmAndamento(aula) {
  // FIX 1.1: guarda contra horario/dia_semana nulos ou malformados,
  // que antes lançavam TypeError e derrubavam o fetchDados inteiro.
  if (!aula?.dia_semana || !aula?.horario) return false;

  const agora = new Date();
  const diaHoje = agora.toLocaleDateString('pt-BR', { weekday: 'long' });
  const diaHojeFormatado = diaHoje.charAt(0).toUpperCase() + diaHoje.slice(1);

  if (aula.dia_semana !== diaHojeFormatado) return false;

  const [h, m] = aula.horario.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;

  const horaAtual = agora.getHours() * 60 + agora.getMinutes();
  const inicioAula = h * 60 + m;
  const duracaoMin = aula.duracao_minutos ?? 60;
  const fimAula = inicioAula + duracaoMin;
  return horaAtual >= inicioAula - 30 && horaAtual <= fimAula;
}

function obterPeriodo(periodo) {
  const hoje = new Date();
  const inicio = new Date(hoje);
  const fim = new Date(hoje);
  if (periodo === 'hoje') {
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);
  } else if (periodo === 'semana') {
    inicio.setDate(hoje.getDate() - hoje.getDay());
    inicio.setHours(0, 0, 0, 0);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);
  } else if (periodo === 'mes') {
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    fim.setMonth(fim.getMonth() + 1, 0);
    fim.setHours(23, 59, 59, 999);
  }
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

// FIX 3.2: sanitização de célula CSV — neutraliza fórmulas (=, +, -, @) e
// escapa aspas internas corretamente (antes só tratava vírgula).
function sanitizarCelulaCSV(valor) {
  if (valor === null || valor === undefined) return '';
  let v = String(valor);
  if (/^[=+\-@]/.test(v)) v = `'${v}`; // neutraliza CSV/formula injection
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// FIX 2: helper central para log + mensagem amigável, evita
// catch(e) genérico espalhado e silencioso pelo arquivo inteiro.
function tratarErro(err, { contexto, mensagemPadrao }) {
  // eslint-disable-next-line no-console
  console.error(`[Presenca] ${contexto} falhou:`, err);
  if (err?.code === '42501' || err?.status === 403) {
    return 'Você não tem permissão para executar esta ação.';
  }
  return mensagemPadrao;
}

export default function Presenca({ isAdmin = false }) {
  const [modo, setModo] = useState('chamada');
  const [modoInicializado, setModoInicializado] = useState(false); // FIX 1.2
  const [alunos, setAlunos]       = useState([]);
  const [aulas, setAulas]         = useState([]);
  const [todasAulas, setTodasAulas] = useState([]);
  const [presencas, setPresencas] = useState([]);
  const [loading, setLoading]     = useState(true);

  const [aulaAtiva, setAulaAtiva]               = useState(null);
  const [checkinsDaAula, setCheckinsDaAula]       = useState(new Set());
  const [alunosFixosDaAula, setAlunosFixosDaAula] = useState(new Set());
  const [loadingCheckin, setLoadingCheckin]       = useState(null);

  const [metricas, setMetricas] = useState({
    checkinsHoje: 0, frequenciaMedia: 0, alunosAtivos: 0,
    presencaSemana: [], mediaDiaria: 0
  });
  const [filtros, setFiltros]         = useState({ periodo: 'hoje', aluno: 'todos', aula: 'todas' });
  const [busca, setBusca]             = useState('');
  const [aulaSelecionada, setAulaSelecionada] = useState(null);
  const [dataManual, setDataManual] = useState(() => new Date().toISOString().split('T')[0]);
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const modalQRCode   = useModal();
  const modalDetalhes = useModal();
  const queryClient = useQueryClient();
  const [agendadosDaAula, setAgendadosDaAula] = useState(new Map());
  const [buscaChamada, setBuscaChamada] = useState('');

  const fetchDados = useCallback(async () => {
    setLoading(true);
    try {
      // Alunos ativos
      const { data: alunosData, error: errAlunos } = await supabase
        .from('alunos')
        .select('id, nome_completo, email, plano_id, planos(frequencia_semanal)')
        .eq('ativo', true)
        .eq('role', 'aluno')
        .order('nome_completo');
      if (errAlunos) throw errAlunos;

      const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
      const diaFormatado = hoje.charAt(0).toUpperCase() + hoje.slice(1);

      let aulasQuery = supabase
        .from('agenda')
        .select('*')
        .eq('ativa', true)
        .order('dia_semana')
        .order('horario');

      if (filtros.periodo === 'hoje') {
        aulasQuery = aulasQuery.eq('dia_semana', diaFormatado);
      }

      // Todas as aulas ativas — usado no seletor manual da Chamada Rápida
      const todasAulasQuery = supabase
        .from('agenda')
        .select('id, atividade, horario, dia_semana')
        .eq('ativa', true)
        .order('dia_semana')
        .order('horario');

      const [{ data: aulasData, error: errAulas }, { data: todasAulasData, error: errTodasAulas }] =
        await Promise.all([aulasQuery, todasAulasQuery]);
      if (errAulas) throw errAulas;
      if (errTodasAulas) throw errTodasAulas;

      const { inicio, fim } = obterPeriodo(filtros.periodo);
      const inicioData = inicio.split('T')[0];
      const fimData = fim.split('T')[0];
      const { data: presencasData, error: errPresencas } = await supabase
        .from('presencas')
        .select(`*, alunos(nome_completo, email), agenda(atividade, horario)`)
        .eq('status', 'presente') // só presença real confirmada entra no relatório
        .gte('data_aula', inicioData)
        .lte('data_aula', fimData)
        .order('data_checkin', { ascending: false });
      if (errPresencas) throw errPresencas;

      setAlunos(alunosData || []);
      setAulas(aulasData || []);
      setTodasAulas(todasAulasData || []);
      setPresencas(presencasData || []);

      const aulaEmCurso = (aulasData || []).find(aulaEmAndamento) || null;
      setAulaAtiva(aulaEmCurso);

      if (aulaEmCurso) {
        const hojeDateStr = new Date().toISOString().split('T')[0];
        const [{ data: todasPresencasHoje, error: errHoje }, { data: fixosDaAula, error: errFixos }] =
          await Promise.all([
            supabase
              .from('presencas')
              .select('id, aluno_id, status, origem')
              .eq('aula_id', aulaEmCurso.id)
              .eq('data_aula', hojeDateStr),
            supabase
              .from('agenda_fixa')
              .select('aluno_id')
              .eq('aula_id', aulaEmCurso.id),
          ]);
        if (errHoje) throw errHoje;
        if (errFixos) throw errFixos;

        const confirmados = (todasPresencasHoje || []).filter(p => p.status === 'presente');
        const pendentes = (todasPresencasHoje || []).filter(
          p => p.status === 'agendado' && !confirmados.find(c => c.aluno_id === p.aluno_id)
        );

        setCheckinsDaAula(new Set(confirmados.map(c => c.aluno_id)));
        setAgendadosDaAula(new Map(pendentes.map(p => [p.aluno_id, p.id])));
        setAlunosFixosDaAula(new Set((fixosDaAula || []).map(f => f.aluno_id)));
      } else {
        setCheckinsDaAula(new Set());
        setAlunosFixosDaAula(new Set());
      }

      // FIX 1.2: a troca automática de aba agora acontece de fato, mas só na
      // primeira carga — não sobrescreve a aba que o usuário escolher depois.
      if (!modoInicializado) {
        setModo(aulaEmCurso ? 'chamada' : 'relatorio');
        setModoInicializado(true);
      }

      calcularMetricas(presencasData || [], alunosData || []);
    } catch (err) {
      showToast.error(tratarErro(err, {
        contexto: 'fetchDados',
        mensagemPadrao: 'Erro ao carregar dados de presença.',
      }));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.periodo, modoInicializado]);

  useEffect(() => { fetchDados(); }, [filtros.periodo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quando o usuário muda a aula selecionada manualmente (sem aula automática ativa),
  // atualiza os Sets de check-ins e de fixos para refletir quem pertence àquela aula.
  useEffect(() => {
    if (aulaAtiva || !aulaSelecionada) {
      if (!aulaAtiva) {
        setCheckinsDaAula(new Set());
        setAlunosFixosDaAula(new Set());
      }
      return;
    }

    // FIX 1.4: flag de "efeito vivo" evita que uma resposta obsoleta
    // (troca rápida de aula no <select>) sobrescreva o estado mais recente.
    let ativo = true;

    async function buscarDadosAulaSelecionada() {
      const hojeDateStr = new Date().toISOString().split('T')[0];
      try {
        const [{ data: todasHoje, error: errHoje }, { data: fixosDaAula, error: errFixos }] =
          await Promise.all([
            supabase
              .from('presencas')
              .select('id, aluno_id, status, origem')
              .eq('aula_id', aulaSelecionada)
              .eq('data_aula', hojeDateStr),
            supabase
              .from('agenda_fixa')
              .select('aluno_id')
              .eq('aula_id', aulaSelecionada),
          ]);
        if (errHoje) throw errHoje;
        if (errFixos) throw errFixos;
        if (!ativo) return; // resposta obsoleta — descarta

        const confirmados = (todasHoje || []).filter(p => p.status === 'presente');
        const pendentes = (todasHoje || []).filter(
          p => p.status === 'agendado' && !confirmados.find(c => c.aluno_id === p.aluno_id)
        );
        setCheckinsDaAula(new Set(confirmados.map(c => c.aluno_id)));
        setAgendadosDaAula(new Map(pendentes.map(p => [p.aluno_id, p.id])));
        setAlunosFixosDaAula(new Set((fixosDaAula || []).map(f => f.aluno_id)));
      } catch (err) {
        if (!ativo) return;
        showToast.error(tratarErro(err, {
          contexto: 'buscarDadosAulaSelecionada',
          mensagemPadrao: 'Erro ao carregar dados da aula selecionada.',
        }));
      }
    }

    buscarDadosAulaSelecionada();
    return () => { ativo = false; };
  }, [aulaSelecionada, aulaAtiva]);

  function calcularMetricas(presencasData, alunosData) {
    const hoje = new Date().toISOString().split('T')[0];
    const alunosAtivos = alunosData.length;
    const semanaAtras = new Date();
    semanaAtras.setDate(semanaAtras.getDate() - 7);

    // O(n) — single pass: conta check-ins de hoje, por aluno e por dia da semana
    let checkinsHoje = 0;
    const presencasPorAluno = new Map();
    const presencasPorDia   = new Array(7).fill(0);

    for (const p of presencasData) {
      if (!p.data_checkin) continue;
      if (p.data_checkin.split('T')[0] === hoje) checkinsHoje++;
      if (new Date(p.data_checkin) >= semanaAtras) {
        if (p.aluno_id != null) {
          presencasPorAluno.set(p.aluno_id, (presencasPorAluno.get(p.aluno_id) || 0) + 1);
        }
        presencasPorDia[new Date(p.data_checkin).getDay()]++;
      }
    }

    const taxasIndividuais = alunosData.map(aluno => {
      const esperado = Number(aluno.planos?.frequencia_semanal) || 1;
      const real     = presencasPorAluno.get(aluno.id) || 0;
      return Math.min(real / esperado, 1);
    });

    const frequenciaMedia =
      alunosAtivos > 0
        ? ((taxasIndividuais.reduce((acc, taxa) => acc + taxa, 0) / alunosAtivos) * 100).toFixed(1)
        : 0;

    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const presencaPorDia = diasSemana.map((dia, idx) => ({
      dia,
      total: presencasPorDia[idx],
    }));

    const totalSemana  = presencasPorDia.reduce((acc, v) => acc + v, 0);
    const mediaDiaria  = Math.round(totalSemana / 7);
    setMetricas({ checkinsHoje, frequenciaMedia, alunosAtivos, presencaSemana: presencaPorDia, mediaDiaria });
  }

  // ─── check-in ─────────────────────────────────────────────────────────────
  async function realizarCheckin(aluno, aulaId, dataRef = null) {
    if (!aulaId) {
      showToast.error('Selecione uma aula para fazer o check-in.');
      return;
    }
    setLoadingCheckin(aluno.id);
    // dataAula: 'YYYY-MM-DD' — hoje por padrão, ou data retroativa/manual
    const dataAula = dataRef ?? new Date().toISOString().split('T')[0];
    const dataCheckin = dataRef
      ? `${dataRef}T12:00:00.000Z`
      : new Date().toISOString();
    try {
      const agendadoId = agendadosDaAula.get(aluno.id) ?? null;

      if (agendadoId) {
        // FIX 1.3 (parte 1): marca a origem como 'agendamento' para que o
        // desfazer saiba reverter o status em vez de apagar o registro.
        const { error } = await supabase
          .from('presencas')
          .update({ status: 'presente', data_checkin: dataCheckin, origem: 'agendamento' })
          .eq('id', agendadoId);
        if (error) throw error;
      } else {
        const payload = {
          aluno_id: aluno.id,
          aula_id: aulaId,
          data_aula: dataAula,
          status: 'presente',
          origem: alunosFixosDaAula.has(aluno.id) ? 'fixo' : 'avulso',
          data_checkin: dataCheckin,
        };

        const { error } = await supabase
          .from('presencas')
          .upsert([payload], {
            onConflict: 'aluno_id,aula_id,data_aula',
            ignoreDuplicates: true,
          });

        if (error) {
          if (error.code === '23505') {
            showToast.error(`${aluno.nome_completo} já fez check-in hoje!`);
            return;
          }
          throw error;
        }
      }

      showToast.success(`✅ ${aluno.nome_completo}`);

      setCheckinsDaAula(prev => new Set([...prev, aluno.id]));
      setAgendadosDaAula(prev => {
        const next = new Map(prev);
        next.delete(aluno.id);
        return next;
      });
      setMetricas(prev => ({ ...prev, checkinsHoje: prev.checkinsHoje + 1 }));

      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
    } catch (err) {
      showToast.error(tratarErro(err, {
        contexto: 'realizarCheckin',
        mensagemPadrao: 'Erro ao registrar presença.',
      }));
    } finally {
      setLoadingCheckin(null);
    }
  }

  // FIX 1.3 (parte 2): desfazer agora reverte para 'agendado' quando o
  // registro veio de um agendamento formal, em vez de apagar o vínculo.
  async function desfazerCheckin(aluno) {
    // FIX 3.1: camada extra de defesa no client — a autorização "de verdade"
    // deve estar garantida via RLS no Supabase (a confirmar com o time de backend).
    if (!isAdmin) {
      showToast.error('Você não tem permissão para desfazer check-ins.');
      return;
    }
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const aulaIdAtual = aulaAtiva?.id ?? (aulaSelecionada ? Number(aulaSelecionada) : null);
      const { data: reg, error: errBusca } = await supabase
        .from('presencas')
        .select('id, origem')
        .eq('aluno_id', aluno.id)
        .eq('aula_id', aulaIdAtual)
        .eq('data_aula', hoje)
        .maybeSingle();
      if (errBusca) throw errBusca;
      if (!reg) { showToast.error('Registro não encontrado.'); return; }

      if (reg.origem === 'agendamento') {
        const { error } = await supabase
          .from('presencas')
          .update({ status: 'agendado', data_checkin: null })
          .eq('id', reg.id);
        if (error) throw error;
        setAgendadosDaAula(prev => new Map(prev).set(aluno.id, reg.id));
      } else {
        const { error } = await supabase.from('presencas').delete().eq('id', reg.id);
        if (error) throw error;
      }

      showToast.success(`↩️ Check-in desfeito: ${aluno.nome_completo}`);
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setCheckinsDaAula(prev => {
        const next = new Set(prev);
        next.delete(aluno.id);
        return next;
      });
      setMetricas(prev => ({ ...prev, checkinsHoje: Math.max(0, prev.checkinsHoje - 1) }));
    } catch (err) {
      showToast.error(tratarErro(err, {
        contexto: 'desfazerCheckin',
        mensagemPadrao: 'Erro ao desfazer check-in.',
      }));
    }
  }

  async function marcarAusencia(aluno, presencaId) {
    // FIX 3.1: mesma camada extra de defesa client-side.
    if (!isAdmin) {
      showToast.error('Você não tem permissão para marcar ausências.');
      return;
    }
    if (!presencaId) return;
    try {
      const dataRef = aulaAtiva ? new Date().toISOString().split('T')[0] : dataManual;
      await agendamentoService.registrarFalta(aluno.id, aulaEmUso, dataRef);
      setAgendadosDaAula(prev => {
        const next = new Map(prev);
        next.delete(aluno.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      showToast.success(`${aluno.nome_completo} marcado como ausente. Professor será notificado.`);
    } catch (err) {
      showToast.error(tratarErro(err, {
        contexto: 'marcarAusencia',
        mensagemPadrao: 'Erro ao marcar ausência.',
      }));
    }
  }

  async function visualizarDetalhes(aluno) {
    try {
      const trintaDiasAtras = new Date();
      trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
      const trintaDiasAtrasStr = trintaDiasAtras.toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('presencas')
        .select(`*, agenda(atividade, horario)`)
        .eq('aluno_id', aluno.id)
        .eq('status', 'presente')
        .gte('data_aula', trintaDiasAtrasStr)
        .order('data_checkin', { ascending: false });
      if (error) throw error;
      setAlunoSelecionado({ ...aluno, historico: data || [] });
      modalDetalhes.abrir();
    } catch (err) {
      showToast.error(tratarErro(err, {
        contexto: 'visualizarDetalhes',
        mensagemPadrao: 'Erro ao carregar histórico.',
      }));
    }
  }

  // FIX 3.2: exportação agora sanitiza fórmulas e aspas corretamente.
  function exportarRelatorio() {
    const dadosExport = presencasFiltradas.map(p => ({
      Aluno: p.alunos?.nome_completo,
      Email: p.alunos?.email,
      'Data/Hora': new Date(p.data_checkin).toLocaleString('pt-BR'),
      Aula: p.agenda?.atividade || 'Treino Livre',
      Horário: p.agenda?.horario || '-',
      Status: p.status
    }));
    if (!dadosExport.length) { showToast.error('Nenhum dado para exportar.'); return; }
    const headers = Object.keys(dadosExport[0]);
    const csvRows = [
      headers.join(','),
      ...dadosExport.map(row => headers.map(h => sanitizarCelulaCSV(row[h])).join(','))
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `presencas_${filtros.periodo}.csv`);
    link.click();
    URL.revokeObjectURL(url); // libera memória — pequeno leak evitado
    showToast.success('Relatório exportado!');
  }

  // ─── dados derivados (memoizados — FIX 4.2) ────────────────────────────────
  const presencasFiltradas = useMemo(() => presencas.filter(p => {
    const matchAluno = filtros.aluno === 'todos' || p.aluno_id === Number(filtros.aluno);
    const matchAula  = filtros.aula  === 'todas' || p.aula_id  === Number(filtros.aula);
    return matchAluno && matchAula;
  }), [presencas, filtros.aluno, filtros.aula]);

  // Aula em uso (automática ou selecionada manualmente)
  const aulaEmUso = aulaAtiva?.id ?? (aulaSelecionada ? Number(aulaSelecionada) : null);

  const filtrarPorBusca = useCallback((lista) =>
    !buscaChamada
      ? lista
      : lista.filter(a =>
          a.nome_completo?.toLowerCase().includes(buscaChamada.toLowerCase()) ||
          a.email?.toLowerCase().includes(buscaChamada.toLowerCase())
        ), [buscaChamada]);

  // Quando há uma aula em uso, separa alunos da turma (fixos) dos demais.
  // Os fixos aparecem no topo da lista para facilitar a chamada.
  const alunosDaAula = useMemo(
    () => (aulaEmUso ? alunos.filter(a => alunosFixosDaAula.has(a.id)) : []),
    [aulaEmUso, alunos, alunosFixosDaAula]
  );
  const alunosRestantes = useMemo(
    () => (aulaEmUso ? alunos.filter(a => !alunosFixosDaAula.has(a.id)) : alunos),
    [aulaEmUso, alunos, alunosFixosDaAula]
  );

  const alunosDaAulaFiltrados    = useMemo(() => filtrarPorBusca(alunosDaAula), [filtrarPorBusca, alunosDaAula]);
  const alunosRestantesFiltrados = useMemo(() => filtrarPorBusca(alunosRestantes), [filtrarPorBusca, alunosRestantes]);

  // Lista final: alunos da turma primeiro, depois os demais ativos
  const alunosChamadaFiltrados = useMemo(
    () => [...alunosDaAulaFiltrados, ...alunosRestantesFiltrados],
    [alunosDaAulaFiltrados, alunosRestantesFiltrados]
  );

  const presentes = useMemo(
    () => alunosChamadaFiltrados.filter(a => checkinsDaAula.has(a.id)),
    [alunosChamadaFiltrados, checkinsDaAula]
  );
  const ausentes = useMemo(
    () => alunosChamadaFiltrados.filter(a => !checkinsDaAula.has(a.id)),
    [alunosChamadaFiltrados, checkinsDaAula]
  );
  const totalPresentes = checkinsDaAula.size;

  const agendadosFiltrados = useMemo(
    () => alunos
      .filter(a => agendadosDaAula.has(a.id))
      .filter(a =>
        !buscaChamada ||
        a.nome_completo?.toLowerCase().includes(buscaChamada.toLowerCase()) ||
        a.email?.toLowerCase().includes(buscaChamada.toLowerCase())
      ),
    [alunos, agendadosDaAula, buscaChamada]
  );

  // FIX 4.3: máximo do gráfico calculado uma única vez, fora do .map() de render.
  const maxAlturaSemana = useMemo(
    () => Math.max(...metricas.presencaSemana.map(d => d.total), 0),
    [metricas.presencaSemana]
  );

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 space-y-6 animate-in fade-in duration-500">
      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">
            Presença & Check-in
          </h1>
          <p className="text-muted-foreground">Controle de frequência dos alunos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="md" leftIcon={<QrCode size={18} />} onClick={modalQRCode.abrir}>
            QR Code
          </Button>
          <Button variant="outline" size="md" leftIcon={<Download size={18} />} onClick={exportarRelatorio}>
            Exportar
          </Button>
        </div>
      </div>

      {/* ── Abas: Chamada Rápida | Relatório ──────────────────────────────── */}
      <div className="flex gap-1 bg-muted p-1 rounded-2xl border border-border w-fit">
        <button
          onClick={() => setModo('chamada')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
            modo === 'chamada'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Zap size={15} />
          Chamada Rápida
          {aulaAtiva && (
            <span className="ml-1 w-2 h-2 rounded-full bg-success animate-pulse inline-block" />
          )}
        </button>
        <button
          onClick={() => setModo('relatorio')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
            modo === 'relatorio'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart2 size={15} />
          Relatório
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* ABA: CHAMADA RÁPIDA                                                 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {modo === 'chamada' && (
        <div className="space-y-5">
          {/* Banner da aula ativa ou aviso de nenhuma aula */}
          {loading ? (
            <Skeleton.Card />
          ) : aulaAtiva ? (
            <Surface variant="card" padding="lg" className="rounded-[28px] border-2 border-primary/30 bg-primary-soft/20">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
                    <Clock size={22} className="text-primary-foreground" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-0.5">
                      Aula em andamento agora
                    </p>
                    <h2 className="text-xl font-black text-foreground">
                      {aulaAtiva.atividade}
                    </h2>
                    <p className="text-sm text-muted-foreground font-medium">
                      {aulaAtiva.horario} · {aulaAtiva.dia_semana}
                    </p>
                  </div>
                </div>
                <div className="flex gap-6 text-center">
                  <div>
                    <p className="text-3xl font-black text-success">{totalPresentes}</p>
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Presentes</p>
                  </div>
                  <div>
                    <p className="text-3xl font-black text-muted-foreground">
                      {Math.max(alunosDaAula.length - totalPresentes, 0)}
                    </p>
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Ausentes</p>
                  </div>
                  <div>
                    <p className="text-3xl font-black text-foreground">{alunosDaAula.length}</p>
                    <p className="text-[10px] font-black uppercase text-muted-foreground">Na Turma</p>
                  </div>
                </div>
              </div>
            </Surface>
          ) : (
            <Surface variant="card" padding="lg" className="rounded-[28px] border border-dashed border-border">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-muted rounded-2xl flex items-center justify-center shrink-0">
                  <Calendar size={22} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="font-bold text-foreground">Nenhuma aula em andamento agora</p>
                  <p className="text-sm text-muted-foreground">
                    A chamada automática aparece quando há uma aula ±30 min do horário atual.
                    Você ainda pode registrar presenças manualmente abaixo.
                  </p>
                </div>
              </div>
            </Surface>
          )}

          {/* Seletor de aula manual — exibido somente quando não há aula em andamento automática */}
          {!loading && !aulaAtiva && todasAulas.length > 0 && (
            <Surface variant="card" padding="md" className="rounded-[20px] space-y-3">
              <div>
                <Label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-2">
                  Registrar para qual aula?
                </Label>
                <Input
                  as="select"
                  value={aulaSelecionada ?? ''}
                  onChange={e => setAulaSelecionada(e.target.value || null)}
                  className="bg-card"
                >
                  <option value="">— Selecione uma aula —</option>
                  {todasAulas.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.dia_semana} · {a.atividade} · {a.horario}
                    </option>
                  ))}
                </Input>
                {!aulaSelecionada && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Selecione uma aula para liberar o check-in dos alunos.
                  </p>
                )}
              </div>
              <div>
                <Label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-2">
                  Data da presença
                </Label>
                <Input
                  type="date"
                  value={dataManual}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={e => setDataManual(e.target.value)}
                  className="bg-card w-auto"
                />
              </div>
            </Surface>
          )}

          {/* Busca — só disponível quando há uma aula em uso (automática ou selecionada) */}
          {aulaEmUso && (
            <Input
              leftIcon={<Search size={18} />}
              placeholder="Buscar aluno por nome ou e-mail..."
              value={buscaChamada}
              onChange={e => setBuscaChamada(e.target.value)}
            />
          )}

          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <Skeleton.Row key={i} />)}
            </div>
          ) : !aulaEmUso ? (
            <EmptyState
              icon={<Calendar size={28} />}
              title="Selecione uma aula"
              description="Escolha uma aula acima para liberar o check-in dos alunos."
            />
          ) : alunosChamadaFiltrados.length === 0 ? (
            <EmptyState
              icon={<Users size={28} />}
              title="Nenhum aluno encontrado"
              description="Tente outro nome ou e-mail."
            />
          ) : (
            <div className="space-y-6">

              {/* Agendados via Agenda */}
              {agendadosDaAula.size > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <Clock size={14} className="text-warning" />
                    <p className="text-xs font-black uppercase tracking-widest text-warning">
                      Agendados — aguardando confirmação ({agendadosDaAula.size})
                    </p>
                  </div>
                  {agendadosFiltrados.map(aluno => (
                    <div
                      key={aluno.id}
                      className="flex items-center justify-between w-full p-4 bg-warning-soft border border-warning/20 rounded-2xl"
                    >
                      <div className="flex items-center gap-3">
                        <Clock className="text-warning shrink-0" size={22} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-foreground">{aluno.nome_completo}</p>
                            {alunosFixosDaAula.has(aluno.id) && (
                              <Badge tone="info" variant="soft" size="sm">Turma fixa</Badge>
                            )}
                            <Badge tone="warning" variant="soft" size="sm">Agendado</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{aluno.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="brand"
                          disabled={loadingCheckin === aluno.id}
                          onClick={() => realizarCheckin(aluno, aulaEmUso, aulaAtiva ? null : dataManual)}
                        >
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={loadingCheckin === aluno.id || !isAdmin}
                          onClick={() => marcarAusencia(aluno, agendadosDaAula.get(aluno.id))}
                        >
                          Ausente
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Subseção: Ausentes (aparecem primeiro para facilitar o check-in) */}
              {ausentes.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 px-1">
                    Ausentes ({ausentes.length})
                  </p>
                  <div className="space-y-2">
                    {ausentes.map(aluno => (
                      <BotaoAluno
                        key={aluno.id}
                        aluno={aluno}
                        presente={false}
                        isDaAula={alunosFixosDaAula.has(aluno.id)}
                        aulaId={aulaAtiva?.id ?? (aulaSelecionada ? Number(aulaSelecionada) : null)}
                        loadingId={loadingCheckin}
                        onCheckin={(aluno, aulaId) => realizarCheckin(aluno, aulaId, aulaAtiva ? null : dataManual)}
                        onDesfazer={desfazerCheckin}
                        onDetalhes={visualizarDetalhes}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Subseção: Presentes */}
              {presentes.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 px-1">
                    Presentes ({presentes.length})
                  </p>
                  <div className="space-y-2">
                    {presentes.map(aluno => (
                      <BotaoAluno
                        key={aluno.id}
                        aluno={aluno}
                        presente={true}
                        isDaAula={alunosFixosDaAula.has(aluno.id)}
                        aulaId={aulaAtiva?.id ?? (aulaSelecionada ? Number(aulaSelecionada) : null)}
                        loadingId={loadingCheckin}
                        onCheckin={(aluno, aulaId) => realizarCheckin(aluno, aulaId, aulaAtiva ? null : dataManual)}
                        onDesfazer={desfazerCheckin}
                        onDetalhes={visualizarDetalhes}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* ABA: RELATÓRIO                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {modo === 'relatorio' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => <Skeleton.Card key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <CardMetrica titulo="Check-ins Hoje"    valor={metricas.checkinsHoje}         icone={<CheckCircle2 />} tone="success" />
              <CardMetrica titulo="Taxa de Frequência" valor={`${metricas.frequenciaMedia}%`} subtitulo="última semana" icone={<TrendingUp />} tone="info" />
              <CardMetrica titulo="Alunos Ativos"     valor={metricas.alunosAtivos}          icone={<Users />}        tone="brand" />
              <CardMetrica titulo="Média Diária"      valor={metricas.mediaDiaria}           subtitulo="últimos 7 dias" icone={<Award />}    tone="purple" />
            </div>
          )}

          {/* Gráfico semanal */}
          {metricas.presencaSemana.length > 0 && (
            <Surface variant="card" padding="xl" className="rounded-[40px]">
              <h3 className="font-bold text-foreground mb-6">Distribuição Semanal</h3>
              <div className="flex gap-2 items-end h-48">
                {metricas.presencaSemana.map((dia, idx) => {
                  // FIX 4.3: maxAlturaSemana calculado uma única vez fora do map.
                  const altura = maxAlturaSemana > 0 ? (dia.total / maxAlturaSemana) * 100 : 0;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                      <div className="flex-1 flex items-end w-full">
                        <div
                          className="bg-primary rounded-t-xl w-full transition-all hover:brightness-95"
                          style={{ height: `${altura}%`, minHeight: dia.total > 0 ? '20px' : '0' }}
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground">{dia.total}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">{dia.dia}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Surface>
          )}

          {/* Filtros */}
          <Surface variant="card" padding="lg" className="rounded-[28px]">
            <div className="flex flex-wrap gap-4">
              <div className="flex gap-2 bg-muted p-1 rounded-2xl border border-border">
                {['hoje', 'semana', 'mes'].map(periodo => (
                  <button
                    key={periodo}
                    onClick={() => setFiltros({ ...filtros, periodo })}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
                      filtros.periodo === periodo
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {periodo}
                  </button>
                ))}
              </div>
              <Input as="select" className="w-auto" value={filtros.aluno}
                onChange={e => setFiltros({ ...filtros, aluno: e.target.value })}>
                <option value="todos">Todos os Alunos</option>
                {alunos.map(a => <option key={a.id} value={a.id}>{a.nome_completo}</option>)}
              </Input>
              <Input as="select" className="w-auto" value={filtros.aula}
                onChange={e => setFiltros({ ...filtros, aula: e.target.value })}>
                <option value="todas">Todas as Aulas</option>
                {aulas.map(a => <option key={a.id} value={a.id}>{a.atividade} - {a.horario}</option>)}
              </Input>
            </div>
          </Surface>

          {/* Tabela */}
          <Surface variant="card" padding="none" className="rounded-[40px] overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton.Row key={i} />)}
              </div>
            ) : presencasFiltradas.length === 0 ? (
              <EmptyState
                icon={<Users size={28} />}
                title="Nenhuma presença registrada"
                description="Faça o primeiro check-in do dia!"
              />
            ) : (
              <table className="w-full text-left">
                <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-8 py-5">Aluno</th>
                    <th className="px-8 py-5">Atividade</th>
                    <th className="px-8 py-5">Data/Hora</th>
                    <th className="px-8 py-5">Tipo</th>
                    <th className="px-8 py-5 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {presencasFiltradas.map(p => (
                    <tr key={p.id} className="hover:bg-primary-soft/30 transition-colors">
                      <td className="px-8 py-5">
                        <p className="font-bold text-foreground">{p.alunos?.nome_completo}</p>
                        <p className="text-[10px] text-muted-foreground font-medium">{p.alunos?.email}</p>
                      </td>
                      <td className="px-8 py-5">
                        <span className="text-sm font-medium text-foreground">
                          {p.agenda?.atividade || 'Treino Livre'}
                        </span>
                        {p.agenda?.horario && (
                          <p className="text-xs text-muted-foreground">{p.agenda.horario}</p>
                        )}
                      </td>
                      <td className="px-8 py-5 text-sm text-muted-foreground">
                        {new Date(p.data_checkin).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-8 py-5">
                        <Badge tone={p.status === 'presente' ? 'success' : 'neutral'} variant="soft">
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <Button variant="outline" size="sm"
                          onClick={() => {
                            const aluno = alunos.find(a => a.id === p.aluno_id);
                            if (aluno) visualizarDetalhes(aluno);
                          }}>
                          Ver Histórico
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Surface>
        </div>
      )}

      {/* ─── Modais ────────────────────────────────────────────────────────── */}
      {/* Detalhes do aluno */}
      {alunoSelecionado && (
        <Modal aberto={modalDetalhes.aberto} fechar={modalDetalhes.fechar}
          title={`Histórico: ${alunoSelecionado.nome_completo}`}>
          <div className="space-y-6 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <Surface variant="muted" padding="md" className="rounded-2xl">
                <p className="text-xs font-black text-success uppercase mb-1">Total (30 dias)</p>
                <p className="text-2xl font-black text-success">{alunoSelecionado.historico?.length || 0}</p>
              </Surface>
              <Surface variant="muted" padding="md" className="rounded-2xl">
                <p className="text-xs font-black text-info uppercase mb-1">Frequência</p>
                <p className="text-2xl font-black text-info">
                  {alunoSelecionado.planos?.frequencia_semanal || 0}x/sem
                </p>
              </Surface>
            </div>
            <div>
              <h4 className="font-bold text-foreground mb-4">Últimas Presenças</h4>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {alunoSelecionado.historico?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">Sem registros</p>
                ) : (
                  alunoSelecionado.historico?.map(h => (
                    <Surface key={h.id} variant="muted" padding="sm"
                      className="rounded-xl flex justify-between items-center">
                      <div>
                        <p className="font-bold text-sm text-foreground">
                          {h.agenda?.atividade || 'Treino Livre'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(h.data_checkin).toLocaleDateString('pt-BR')} às{' '}
                          {new Date(h.data_checkin).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <CheckCircle2 className="text-success" size={16} />
                    </Surface>
                  ))
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* QR Code */}
      <Modal aberto={modalQRCode.aberto} fechar={modalQRCode.fechar} title="QR Code para Check-in">
        <div className="text-center py-8">
          <Surface variant="muted" padding="none"
            className="w-64 h-64 mx-auto rounded-3xl flex items-center justify-center mb-6">
            <QrCode size={120} className="text-muted-foreground" />
          </Surface>
          <p className="text-sm text-muted-foreground">
            Os alunos podem escanear este QR Code para fazer check-in automático.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Feature em desenvolvimento — integração com app mobile
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ─── sub-componentes ─────────────────────────────────────────────────────────
/**
 * Linha de aluno na chamada rápida.
 * - isDaAula: true quando o aluno está matriculado na agenda_fixa da aula em curso
 * - Ausente: botão verde para marcar presença
 * - Presente: badge verde + botão discreto para desfazer + link histórico
 * - isAdmin: FIX 3.1 — controla se o botão "Desfazer" fica habilitado
 */
function BotaoAluno({ aluno, presente, isDaAula, aulaId, loadingId, onCheckin, onDesfazer, onDetalhes, isAdmin }) {
  const carregando = loadingId === aluno.id;

  if (presente) {
    return (
      <div className="flex items-center justify-between w-full p-4 bg-success-soft border border-success/20 rounded-2xl transition-all">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-success shrink-0" size={22} />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-foreground">{aluno.nome_completo}</p>
              {isDaAula && (
                <Badge tone="info" variant="soft" size="sm">Turma fixa</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{aluno.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDetalhes(aluno)}
            className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted"
          >
            Histórico
          </button>
          <button
            onClick={() => onDesfazer(aluno)}
            disabled={!isAdmin}
            title={isAdmin ? 'Desfazer check-in' : 'Apenas administradores podem desfazer'}
            className="text-[10px] font-black uppercase tracking-widest text-destructive/70 hover:text-destructive transition-colors px-2 py-1 rounded-lg hover:bg-destructive-soft disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            Desfazer
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onCheckin(aluno, aulaId)}
      disabled={carregando}
      className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-2xl hover:border-primary hover:bg-primary-soft/20 active:scale-[0.99] transition-all text-left disabled:opacity-60"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-muted rounded-xl flex items-center justify-center shrink-0">
          <span className="text-sm font-black text-muted-foreground">
            {aluno.nome_completo?.[0]?.toUpperCase()}
          </span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-foreground">{aluno.nome_completo}</p>
            {isDaAula && (
              <Badge tone="info" variant="soft" size="sm">Turma fixa</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{aluno.email}</p>
        </div>
      </div>
      {carregando ? (
        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
      ) : (
        <UserCheck className="text-primary shrink-0" size={22} />
      )}
    </button>
  );
}

const ICON_TONE = {
  brand:   'bg-primary-soft text-primary',
  info:    'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  purple:  'bg-purple-soft text-purple',
  neutral: 'bg-muted text-muted-foreground',
};

function CardMetrica({ titulo, valor, subtitulo, icone, tone = 'neutral' }) {
  return (
    <Surface variant="card" padding="lg" className="rounded-[32px] hover:shadow-md transition-all">
      <div className={`${ICON_TONE[tone]} w-12 h-12 rounded-2xl flex items-center justify-center mb-4`}>
        {icone}
      </div>
      <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-2">{titulo}</p>
      <h2 className="text-3xl font-black text-foreground mb-1">{valor}</h2>
      {subtitulo && <p className="text-xs text-muted-foreground font-medium">{subtitulo}</p>}
    </Surface>
  );
}