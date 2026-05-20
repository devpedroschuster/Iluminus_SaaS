import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  QrCode, Search, UserCheck, Calendar, TrendingUp,
  Clock, Award, AlertCircle, Users, CheckCircle2,
  XCircle, Filter, Download
} from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import { formatarData } from '../lib/utils';

import Modal, { useModal } from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Surface from '../components/ui/Surface';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

export default function Presenca() {
  const [presencas, setPresencas] = useState([]);
  const [alunos, setAlunos] = useState([]);
  const [aulas, setAulas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [metricas, setMetricas] = useState({
    checkinsHoje: 0,
    frequenciaMedia: 0,
    alunosAtivos: 0,
    presencaSemana: []
  });

  const [filtros, setFiltros] = useState({
    periodo: 'hoje',
    aluno: 'todos',
    aula: 'todas'
  });

  const [busca, setBusca] = useState('');
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);

  const modalCheckin = useModal();
  const modalQRCode = useModal();
  const modalDetalhes = useModal();

  useEffect(() => {
    fetchDados();
  }, [filtros.periodo]);

  async function fetchDados() {
    setLoading(true);
    try {
      const { data: alunosData } = await supabase
        .from('alunos')
        .select('id, nome_completo, email, plano_id, planos(frequencia_semanal)')
        .eq('ativo', true)
        .eq('role', 'aluno')
        .order('nome_completo');

      const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
      const diaFormatado = hoje.charAt(0).toUpperCase() + hoje.slice(1);

      const { data: aulasData } = await supabase
        .from('agenda')
        .select('*')
        .eq('ativa', true)
        .eq('dia_semana', diaFormatado)
        .order('horario');

      const { inicio, fim } = obterPeriodo(filtros.periodo);
      const { data: presencasData } = await supabase
        .from('presencas')
        .select(`
          *,
          alunos(nome_completo, email),
          agenda(atividade, horario)
        `)
        .gte('data_checkin', inicio)
        .lte('data_checkin', fim)
        .order('data_checkin', { ascending: false });

      setAlunos(alunosData || []);
      setAulas(aulasData || []);
      setPresencas(presencasData || []);

      calcularMetricas(presencasData || [], alunosData || []);
    } catch (err) {
      showToast.error('Erro ao carregar dados de presença.');
    } finally {
      setLoading(false);
    }
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

    return {
      inicio: inicio.toISOString(),
      fim: fim.toISOString()
    };
  }

  function calcularMetricas(presencasData, alunosData) {
    const hoje = new Date().toISOString().split('T')[0];
    const checkinsHoje = presencasData.filter(
      p => p.data_checkin?.split('T')[0] === hoje
    ).length;

    const alunosAtivos = alunosData.length;

    const semanaAtras = new Date();
    semanaAtras.setDate(semanaAtras.getDate() - 7);

    const presencasSemana = presencasData.filter(
      p => new Date(p.data_checkin) >= semanaAtras
    );

    const alunosComPresenca = new Set(presencasSemana.map(p => p.aluno_id));
    const frequenciaMedia =
      alunosAtivos > 0
        ? ((alunosComPresenca.size / alunosAtivos) * 100).toFixed(1)
        : 0;

    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const presencaPorDia = diasSemana.map((dia, idx) => {
      const count = presencasSemana.filter(
        p => new Date(p.data_checkin).getDay() === idx
      ).length;
      return { dia, total: count };
    });

    setMetricas({
      checkinsHoje,
      frequenciaMedia,
      alunosAtivos,
      presencaSemana: presencaPorDia
    });
  }

  async function realizarCheckin(aluno, aulaId = null) {
    try {
      const hoje = new Date().toISOString().split('T')[0];

      const { data: checkinExistente } = await supabase
        .from('presencas')
        .select('id')
        .eq('aluno_id', aluno.id)
        .gte('data_checkin', hoje + 'T00:00:00')
        .lte('data_checkin', hoje + 'T23:59:59')
        .maybeSingle();

      if (checkinExistente) {
        showToast.error(`${aluno.nome_completo} já fez check-in hoje!`);
        return;
      }

      const { error } = await supabase.from('presencas').insert([
        {
          aluno_id: aluno.id,
          aula_id: aulaId,
          tipo: aulaId ? 'aula' : 'livre',
          data_checkin: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      showToast.success(`✅ Check-in realizado: ${aluno.nome_completo}`);
      modalCheckin.fechar();
      setBusca('');
      fetchDados();
    } catch (err) {
      showToast.error('Erro ao registrar presença.');
    }
  }

  async function visualizarDetalhes(aluno) {
    try {
      const trintaDiasAtras = new Date();
      trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

      const { data } = await supabase
        .from('presencas')
        .select(`*, agenda(atividade, horario)`)
        .eq('aluno_id', aluno.id)
        .gte('data_checkin', trintaDiasAtras.toISOString())
        .order('data_checkin', { ascending: false });

      setAlunoSelecionado({ ...aluno, historico: data || [] });
      modalDetalhes.abrir();
    } catch (err) {
      showToast.error('Erro ao carregar histórico.');
    }
  }

  function exportarRelatorio() {
    const dadosExport = presencasFiltradas.map(p => ({
      Aluno: p.alunos?.nome_completo,
      Email: p.alunos?.email,
      'Data/Hora': new Date(p.data_checkin).toLocaleString('pt-BR'),
      Aula: p.agenda?.atividade || 'Treino Livre',
      Horário: p.agenda?.horario || '-',
      Tipo: p.tipo
    }));

    const headers = Object.keys(dadosExport[0]);
    const csvRows = [
      headers.join(','),
      ...dadosExport.map(row =>
        headers
          .map(header => {
            const value = row[header];
            return typeof value === 'string' && value.includes(',')
              ? `"${value}"`
              : value;
          })
          .join(',')
      )
    ];

    const blob = new Blob([csvRows.join('\n')], {
      type: 'text/csv;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `presencas_${filtros.periodo}.csv`);
    link.click();
    showToast.success('Relatório exportado!');
  }

  const alunosFiltrados = alunos.filter(
    a =>
      !busca ||
      a.nome_completo?.toLowerCase().includes(busca.toLowerCase()) ||
      a.email?.toLowerCase().includes(busca.toLowerCase())
  );

  const presencasFiltradas = presencas.filter(p => {
    const matchAluno =
      filtros.aluno === 'todos' || p.aluno_id === Number(filtros.aluno);
    const matchAula =
      filtros.aula === 'todas' || p.aula_id === Number(filtros.aula);
    return matchAluno && matchAula;
  });

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">

      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">
            Presença & Check-in
          </h1>
          <p className="text-muted-foreground">
            Controle de frequência dos alunos
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            size="md"
            leftIcon={<QrCode size={18} />}
            onClick={modalQRCode.abrir}
          >
            QR Code
          </Button>
          <Button
            variant="outline"
            size="md"
            leftIcon={<Download size={18} />}
            onClick={exportarRelatorio}
          >
            Exportar
          </Button>
          <Button
            variant="brand"
            size="md"
            leftIcon={<UserCheck size={18} />}
            onClick={modalCheckin.abrir}
          >
            Fazer Check-in
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton.Card key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <CardMetrica
            titulo="Check-ins Hoje"
            valor={metricas.checkinsHoje}
            icone={<CheckCircle2 />}
            tone="success"
          />
          <CardMetrica
            titulo="Taxa de Frequência"
            valor={`${metricas.frequenciaMedia}%`}
            subtitulo="última semana"
            icone={<TrendingUp />}
            tone="info"
          />
          <CardMetrica
            titulo="Alunos Ativos"
            valor={metricas.alunosAtivos}
            icone={<Users />}
            tone="brand"
          />
          <CardMetrica
            titulo="Média Diária"
            valor={Math.round(metricas.checkinsHoje * 7 / 1)}
            subtitulo="baseado em hoje"
            icone={<Award />}
            tone="purple"
          />
        </div>
      )}

      {/* Gráfico de barras semanal */}
      {metricas.presencaSemana.length > 0 && (
        <Surface variant="card" padding="xl" className="rounded-[40px]">
          <h3 className="font-bold text-foreground mb-6">
            Distribuição Semanal
          </h3>
          <div className="flex gap-2 items-end h-48">
            {metricas.presencaSemana.map((dia, idx) => {
              const maxAltura = Math.max(
                ...metricas.presencaSemana.map(d => d.total)
              );
              const altura = maxAltura > 0 ? (dia.total / maxAltura) * 100 : 0;
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center gap-2"
                >
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className="bg-primary rounded-t-xl w-full transition-all hover:brightness-95"
                      style={{
                        height: `${altura}%`,
                        minHeight: dia.total > 0 ? '20px' : '0'
                      }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-foreground">
                      {dia.total}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-bold">
                      {dia.dia}
                    </p>
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

          {/* Pills de período */}
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

          <Input
            as="select"
            className="w-auto"
            value={filtros.aluno}
            onChange={e => setFiltros({ ...filtros, aluno: e.target.value })}
          >
            <option value="todos">Todos os Alunos</option>
            {alunos.map(a => (
              <option key={a.id} value={a.id}>
                {a.nome_completo}
              </option>
            ))}
          </Input>

          <Input
            as="select"
            className="w-auto"
            value={filtros.aula}
            onChange={e => setFiltros({ ...filtros, aula: e.target.value })}
          >
            <option value="todas">Todas as Aulas</option>
            {aulas.map(a => (
              <option key={a.id} value={a.id}>
                {a.atividade} - {a.horario}
              </option>
            ))}
          </Input>
        </div>
      </Surface>

      {/* Tabela de presenças */}
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
                <tr
                  key={p.id}
                  className="hover:bg-primary-soft/30 transition-colors"
                >
                  <td className="px-8 py-5">
                    <div>
                      <p className="font-bold text-foreground">
                        {p.alunos?.nome_completo}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {p.alunos?.email}
                      </p>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-sm font-medium text-foreground">
                      {p.agenda?.atividade || 'Treino Livre'}
                    </span>
                    {p.agenda?.horario && (
                      <p className="text-xs text-muted-foreground">
                        {p.agenda.horario}
                      </p>
                    )}
                  </td>
                  <td className="px-8 py-5 text-sm text-muted-foreground">
                    {new Date(p.data_checkin).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-8 py-5">
                    <Badge
                      tone={p.tipo === 'aula' ? 'info' : 'neutral'}
                      variant="soft"
                    >
                      {p.tipo}
                    </Badge>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const aluno = alunos.find(a => a.id === p.aluno_id);
                        if (aluno) visualizarDetalhes(aluno);
                      }}
                    >
                      Ver Histórico
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>

      {/* Modal Check-in */}
      <Modal
        aberto={modalCheckin.aberto}
        fechar={modalCheckin.fechar}
        title="Fazer Check-in"
      >
        <div className="space-y-6 pt-2">
          <Input
            leftIcon={<Search size={20} />}
            type="text"
            placeholder="Buscar aluno por nome ou e-mail..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />

          <div className="max-h-96 overflow-y-auto space-y-2">
            {alunosFiltrados.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Nenhum aluno encontrado
              </p>
            ) : (
              alunosFiltrados.map(aluno => (
                <button
                  key={aluno.id}
                  onClick={() => realizarCheckin(aluno)}
                  className="w-full p-4 bg-card border border-border rounded-2xl hover:border-primary hover:bg-primary-soft/30 transition-all text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-foreground">
                        {aluno.nome_completo}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {aluno.email}
                      </p>
                    </div>
                    <UserCheck className="text-primary" size={20} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Modal Detalhes Aluno */}
      {alunoSelecionado && (
        <Modal
          aberto={modalDetalhes.aberto}
          fechar={modalDetalhes.fechar}
          title={`Histórico: ${alunoSelecionado.nome_completo}`}
        >
          <div className="space-y-6 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <Surface variant="muted" padding="md" className="rounded-2xl">
                <p className="text-xs font-black text-success uppercase mb-1">
                  Total (30 dias)
                </p>
                <p className="text-2xl font-black text-success">
                  {alunoSelecionado.historico?.length || 0}
                </p>
              </Surface>
              <Surface variant="muted" padding="md" className="rounded-2xl">
                <p className="text-xs font-black text-info uppercase mb-1">
                  Frequência
                </p>
                <p className="text-2xl font-black text-info">
                  {alunoSelecionado.planos?.frequencia_semanal || 0}x/sem
                </p>
              </Surface>
            </div>

            <div>
              <h4 className="font-bold text-foreground mb-4">
                Últimas Presenças
              </h4>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {alunoSelecionado.historico?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    Sem registros
                  </p>
                ) : (
                  alunoSelecionado.historico?.map(h => (
                    <Surface
                      key={h.id}
                      variant="muted"
                      padding="sm"
                      className="rounded-xl flex justify-between items-center"
                    >
                      <div>
                        <p className="font-bold text-sm text-foreground">
                          {h.agenda?.atividade || 'Treino Livre'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(h.data_checkin).toLocaleDateString('pt-BR')}{' '}
                          às{' '}
                          {new Date(h.data_checkin).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
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

      <Modal
        aberto={modalQRCode.aberto}
        fechar={modalQRCode.fechar}
        title="QR Code para Check-in"
      >
        <div className="text-center py-8">
          <Surface
            variant="muted"
            padding="none"
            className="w-64 h-64 mx-auto rounded-3xl flex items-center justify-center mb-6"
          >
            <QrCode size={120} className="text-muted-foreground" />
          </Surface>
          <p className="text-sm text-muted-foreground">
            Os alunos podem escanear este QR Code para fazer check-in automático.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Feature em desenvolvimento - integração com app mobile
          </p>
        </div>
      </Modal>
    </div>
  );
}

const ICON_TONE = {
  brand:    'bg-primary-soft text-primary',
  info:     'bg-info-soft text-info',
  success:  'bg-success-soft text-success',
  warning:  'bg-warning-soft text-warning',
  purple:   'bg-purple-soft text-purple',
  neutral:  'bg-muted text-muted-foreground',
};

function CardMetrica({ titulo, valor, subtitulo, icone, tone = 'neutral' }) {
  return (
    <Surface
      variant="card"
      padding="lg"
      className="rounded-[32px] hover:shadow-md transition-all"
    >
      <div
        className={`${ICON_TONE[tone]} w-12 h-12 rounded-2xl flex items-center justify-center mb-4`}
      >
        {icone}
      </div>
      <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mb-2">
        {titulo}
      </p>
      <h2 className="text-3xl font-black text-foreground mb-1">{valor}</h2>
      {subtitulo && (
        <p className="text-xs text-muted-foreground font-medium">{subtitulo}</p>
      )}
    </Surface>
  );
}