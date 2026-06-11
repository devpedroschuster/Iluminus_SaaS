import React, { useEffect, useState, useMemo } from 'react';
import { Search, Users, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { showToast } from '../../components/shared/Toast';
import Surface from '../../components/ui/Surface';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';

const PAGE_SIZE = 10;

// Formata data de última presença em texto legível
function formatarUltimaPresenca(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  const hoje = new Date();
  const diffDias = Math.floor((hoje - d) / 86400000);
  if (diffDias === 0) return 'Hoje';
  if (diffDias === 1) return 'Ontem';
  if (diffDias <= 7) return `${diffDias}d atrás`;
  if (diffDias <= 30) return `${Math.floor(diffDias / 7)}sem atrás`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// Formata telefone para wa.me (remove tudo que não é dígito, adiciona 55 se não tiver)
function formatarWhatsApp(telefone) {
  if (!telefone) return null;
  const digits = telefone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

export default function ProfessorAlunos() {
  const { professorId } = useAuth();
  const navigate = useNavigate();

  const [alunos, setAlunos] = useState([]);
  const [ultimaPresencaMap, setUltimaPresencaMap] = useState({});
  const [modalidades, setModalidades] = useState([]); // para o filtro
  const [modalidadesMap, setModalidadesMap] = useState(new Map()); // id→{id,nome} para resolver nomes
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroModalidade, setFiltroModalidade] = useState('');
  const [pagina, setPagina] = useState(1);

  const buscaDebounced = useDebounce(busca, 300);

  useEffect(() => {
    if (professorId) carregarAlunos();
  }, [professorId]);

  async function carregarAlunos() {
    setLoading(true);
    try {
      // Busca modalidades do professor (por ownership e por aulas na agenda)
      const [{ data: modalidadesOwn }, { data: aulasDoProf }] = await Promise.all([
        supabase
          .from('modalidades')
          .select('id, nome')
          .eq('professor_id', professorId),
        supabase
          .from('agenda')
          .select('modalidade_id')
          .eq('professor_id', professorId),
      ]);

      const idsModalidades = [
        ...new Set([
          ...(modalidadesOwn || []).map(m => m.id),
          ...(aulasDoProf || []).map(a => a.modalidade_id).filter(Boolean),
        ]),
      ];

      if (idsModalidades.length === 0) {
        setAlunos([]);
        setModalidades([]);
        return;
      }

      // Busca nomes das modalidades da agenda que ainda não estão em modalidadesOwn
      const idsApenasAgenda = (aulasDoProf || [])
        .map(a => a.modalidade_id)
        .filter(Boolean)
        .filter(id => !(modalidadesOwn || []).some(m => m.id === id));

      let modalidadesAgenda = [];
      if (idsApenasAgenda.length > 0) {
        const { data } = await supabase
          .from('modalidades')
          .select('id, nome')
          .in('id', idsApenasAgenda);
        modalidadesAgenda = data || [];
      }

      // Mapa id → nome para resolver nomes na renderização sem FK join
      const modalidadesMap = new Map([
        ...(modalidadesOwn || []).map(m => [m.id, m]),
        ...modalidadesAgenda.map(m => [m.id, m]),
      ]);

      const todasModalidades = [...modalidadesMap.values()];
      setModalidades(todasModalidades);
      setModalidadesMap(modalidadesMap);

      const { data: alunosFiltrados, error } = await supabase
        .from('alunos')
        .select(
          'id, nome_completo, email, telefone, ativo, planos(nome), modalidades_selecionadas'
        )
        .eq('ativo', true)
        .eq('role', 'aluno')
        // Usa .overlaps() — traduzido pelo PostgREST para o operador && do Postgres (uuid[])
        .overlaps('modalidades_selecionadas', idsModalidades)
        .order('nome_completo');

      if (error) throw error;

      const listaAlunos = alunosFiltrados || [];
      setAlunos(listaAlunos);

      // Busca última presença de cada aluno em paralelo (batch único)
      if (listaAlunos.length > 0) {
        const alunoIds = listaAlunos.map(a => a.id);
        const { data: presencas } = await supabase
          .from('presencas')
          .select('aluno_id, data_checkin')
          .in('aluno_id', alunoIds)
          .order('data_checkin', { ascending: false });

        // Mantém apenas a última presença por aluno (O(n) com Map)
        const mapa = {};
        for (const p of presencas || []) {
          if (!mapa[p.aluno_id]) {
            mapa[p.aluno_id] = p.data_checkin;
          }
        }
        setUltimaPresencaMap(mapa);
      }
    } catch (err) {
      showToast.error('Erro ao carregar alunos.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Filtragem client-side: busca + modalidade
  const alunosFiltrados = useMemo(() => {
    return alunos.filter(a => {
      const matchBusca =
        !buscaDebounced ||
        a.nome_completo?.toLowerCase().includes(buscaDebounced.toLowerCase()) ||
        a.email?.toLowerCase().includes(buscaDebounced.toLowerCase());

      const matchModalidade =
  !filtroModalidade ||
  (Array.isArray(a.modalidades_selecionadas) &&
    a.modalidades_selecionadas.includes(filtroModalidade));

      return matchBusca && matchModalidade;
    });
  }, [alunos, buscaDebounced, filtroModalidade]);

  // Reseta para página 1 quando filtros mudam
  useEffect(() => { setPagina(1); }, [buscaDebounced, filtroModalidade]);

  // T3 FIX: paginação client-side
  const totalPaginas = Math.max(1, Math.ceil(alunosFiltrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const alunosPagina = alunosFiltrados.slice(
    (paginaAtual - 1) * PAGE_SIZE,
    paginaAtual * PAGE_SIZE
  );

  // Título com contador
  const titulo = loading
    ? 'Meus Alunos'
    : `Meus Alunos · ${alunosFiltrados.length} ativo${alunosFiltrados.length !== 1 ? 's' : ''}`;

  return (
    <div className="p-4 md:p-8 space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">{titulo}</h1>
        <p className="text-muted-foreground font-medium">
          Todos os alunos ativos nas suas turmas.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            leftIcon={<Search size={18} />}
            placeholder="Buscar por nome ou e-mail..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>
        {modalidades.length > 1 && (
          <select
            value={filtroModalidade}
            onChange={e => setFiltroModalidade(e.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Todas as modalidades</option>
            {modalidades.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
        )}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : alunosFiltrados.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Nenhum aluno encontrado"
          description={
            alunos.length === 0
              ? 'Você ainda não tem alunos nas suas modalidades. Fale com o admin.'
              : 'Nenhum aluno corresponde aos filtros aplicados.'
          }
        />
      ) : (
        <>
          {/* DESKTOP: tabela */}
          <Surface variant="card" padding="none" className="hidden md:block rounded-[32px] overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-8 py-5">Aluno</th>
                  <th className="px-8 py-5">Modalidade / Plano</th>
                  <th className="px-8 py-5">Contato</th>
                  <th className="px-8 py-5">Última Presença</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {alunosPagina.map(aluno => {
                  const ultimaPresenca = ultimaPresencaMap[aluno.id];
                  const whatsapp = formatarWhatsApp(aluno.telefone);
                  return (
                    <tr
                      key={aluno.id}
                      className="hover:bg-primary-soft/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/alunos/${aluno.id}`)}
                    >
                      <td className="px-8 py-5">
                        <p className="font-bold text-foreground">{aluno.nome_completo}</p>
                        {aluno.email ? (
                          <a
                            href={`mailto:${aluno.email}`}
                            className="text-xs text-primary hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            {aluno.email}
                          </a>
                        ) : (
                          <p className="text-xs text-muted-foreground">—</p>
                        )}
                      </td>

                      {/* T4 FIX: plano em Badge destacado */}
                      <td className="px-8 py-5">
                        <p className="text-sm font-bold text-foreground">
                          {Array.isArray(aluno.modalidades_selecionadas) && aluno.modalidades_selecionadas.length > 0
                            ? aluno.modalidades_selecionadas
                                .map(id => modalidadesMap.get(id)?.nome)
                                .filter(Boolean)
                                .join(', ') || '—'
                            : '—'}
                        </p>
                        {aluno.planos?.nome && (
                          <Badge tone="info" variant="soft" className="mt-1 text-xs">
                            {aluno.planos.nome}
                          </Badge>
                        )}
                      </td>

                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-1">
                          {aluno.telefone ? (
                            <a
                              href={`tel:${aluno.telefone}`}
                              className="text-sm text-primary font-medium hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {aluno.telefone}
                            </a>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                          {whatsapp && (
                            <a
                              href={`https://wa.me/${whatsapp}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-emerald-600 font-medium hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              Abrir WhatsApp
                            </a>
                          )}
                        </div>
                      </td>

                      <td className="px-8 py-5">
                        {ultimaPresenca ? (
                          <span
                            className={`text-sm font-medium ${
                              (new Date() - new Date(ultimaPresenca)) / 86400000 > 14
                                ? 'text-amber-500'
                                : 'text-foreground'
                            }`}
                          >
                            {formatarUltimaPresenca(ultimaPresenca)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sem registro</span>
                        )}
                      </td>

                      <td className="px-8 py-5">
                        <Badge tone="success" variant="soft">Ativo</Badge>
                      </td>

                      {/* T5 FIX: botão de acesso ao perfil */}
                      <td className="px-8 py-5">
                        <button
                          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          onClick={e => { e.stopPropagation(); navigate(`/alunos/${aluno.id}`); }}
                          title="Ver perfil completo"
                        >
                          <ExternalLink size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Surface>

          {/* MOBILE: cards */}
          <div className="md:hidden space-y-3">
            {alunosPagina.map(aluno => {
              const ultimaPresenca = ultimaPresencaMap[aluno.id];
              const whatsapp = formatarWhatsApp(aluno.telefone);
              const semanas = ultimaPresenca
                ? (new Date() - new Date(ultimaPresenca)) / 86400000
                : null;
              return (
                <Surface
                  key={aluno.id}
                  variant="card"
                  className="rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => navigate(`/alunos/${aluno.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground truncate">{aluno.nome_completo}</p>
                      {aluno.email && (
                        <p className="text-xs text-muted-foreground truncate">{aluno.email}</p>
                      )}
                    </div>
                    <Badge tone="success" variant="soft" className="shrink-0">Ativo</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {Array.isArray(aluno.modalidades_selecionadas) && aluno.modalidades_selecionadas.length > 0 && (
                      <span className="font-medium text-foreground">
                        {aluno.modalidades_selecionadas
                          .map(id => modalidadesMap.get(id)?.nome)
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                    {aluno.planos?.nome && (
                      <Badge tone="info" variant="soft">{aluno.planos.nome}</Badge>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex gap-3">
                      {aluno.telefone && (
                        <a
                          href={`tel:${aluno.telefone}`}
                          className="text-xs text-primary font-medium"
                          onClick={e => e.stopPropagation()}
                        >
                          {aluno.telefone}
                        </a>
                      )}
                      {whatsapp && (
                        <a
                          href={`https://wa.me/${whatsapp}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-600 font-medium"
                          onClick={e => e.stopPropagation()}
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>
                    {ultimaPresenca && (
                      <span className={`text-xs font-medium ${semanas > 14 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        Presença: {formatarUltimaPresenca(ultimaPresenca)}
                      </span>
                    )}
                  </div>
                </Surface>
              );
            })}
          </div>

          {/* T3: Paginação */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                {(paginaAtual - 1) * PAGE_SIZE + 1}–{Math.min(paginaAtual * PAGE_SIZE, alunosFiltrados.length)} de {alunosFiltrados.length}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={paginaAtual === 1}
                  onClick={() => setPagina(p => p - 1)}
                  className="p-2 rounded-lg border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-3 py-2 text-sm font-medium">
                  {paginaAtual} / {totalPaginas}
                </span>
                <button
                  disabled={paginaAtual === totalPaginas}
                  onClick={() => setPagina(p => p + 1)}
                  className="p-2 rounded-lg border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}