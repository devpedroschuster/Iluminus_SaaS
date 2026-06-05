import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboardService';
import {
  AlertCircle, Clock, Cake, MessageCircle,
  CheckCircle2, Bell, Users, CalendarCheck,
  ChevronRight, Wallet,
} from 'lucide-react';
import { addDays, format, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatarMoeda } from '../lib/utils';
import Surface from '../components/ui/Surface';
import Skeleton from '../components/ui/Skeleton';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal, { useModal } from '../components/ui/Modal';
import { Link } from 'react-router-dom';

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcularIdade(dataNasc) {
  if (!dataNasc) return null;
  const hoje = new Date();
  const nasc = new Date(dataNasc + 'T12:00:00');
  let idade = hoje.getFullYear() - nasc.getFullYear();
  if (
    hoje.getMonth() < nasc.getMonth() ||
    (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate())
  ) idade--;
  return idade;
}

function aniversariantesDoDia(alunos) {
  const hoje = new Date();
  const mesHoje = hoje.getMonth() + 1;
  const diaHoje = hoje.getDate();
  return (alunos || []).filter(a => {
    if (!a.data_nascimento) return false;
    const [, m, d] = a.data_nascimento.split('-').map(Number);
    return m === mesHoje && d === diaHoje;
  });
}

function aniversariantesProximos(alunos, dias = 7) {
  const hoje = new Date();
  return (alunos || []).filter(a => {
    if (!a.data_nascimento) return false;
    for (let i = 1; i <= dias; i++) {
      const d = addDays(hoje, i);
      const [, m, day] = a.data_nascimento.split('-').map(Number);
      if (m === d.getMonth() + 1 && day === d.getDate()) return true;
    }
    return false;
  }).sort((a, b) => {
    const [, ma, da] = a.data_nascimento.split('-').map(Number);
    const [, mb, db] = b.data_nascimento.split('-').map(Number);
    return ma !== mb ? ma - mb : da - db;
  });
}

function gerarLinkWhatsApp(telefone, mensagem) {
  const num = (telefone || '').replace(/\D/g, '');
  return `https://wa.me/55${num}?text=${encodeURIComponent(mensagem)}`;
}

// ── Seção de avisos com barra colorida ───────────────────────────────────────
function SecaoAviso({ tipo, icone, titulo, children }) {
  const ESTILOS = {
    danger:  'border-l-4 border-destructive bg-destructive-soft',
    warning: 'border-l-4 border-warning bg-warning-soft',
    success: 'border-l-4 border-success bg-success-soft',
    info:    'border-l-4 border-info bg-info-soft',
    brand:   'border-l-4 border-primary bg-primary-soft',
  };
  const COR_ICONE = {
    danger:  'text-destructive',
    warning: 'text-warning',
    success: 'text-success',
    info:    'text-info',
    brand:   'text-primary',
  };
  return (
    <Surface variant="card" padding="none" className="overflow-hidden">
      <div className={`${ESTILOS[tipo]} px-5 py-4 flex items-center gap-3`}>
        <span className={`shrink-0 ${COR_ICONE[tipo]}`}>{icone}</span>
        <h3 className={`font-black text-sm ${COR_ICONE[tipo]}`}>{titulo}</h3>
      </div>
      <div className="p-5">{children}</div>
    </Surface>
  );
}

// ── Card de aluno compacto ─────────────────────────────────────────────────────
function CardAluno({ nome, info, acao, badge }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-bold text-foreground text-sm truncate">{nome}</p>
        {info && <p className="text-xs text-muted-foreground">{info}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge}
        {acao}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const modalInadimplencia = useModal();

  const agora        = new Date();
  const hojeIso      = agora.toISOString().split('T')[0];
  const inicioMes    = startOfMonth(agora).toISOString();
  const limite7Dias  = format(addDays(agora, 7), 'yyyy-MM-dd');

  // ── Query única — todas as chamadas rodam em paralelo via Promise.all ─────
  const {
    data: {
      totalAlunos        = 0,
      pagamentosMes      = [],
      listaInadimplentes = [],
      alunosPlanosVencendo = [],
      todosAlunos        = [],
    } = {},
    isLoading,
  } = useQuery({
    queryKey: ['dashboard', hojeIso, inicioMes, limite7Dias],
    queryFn:  () => dashboardService.obterTudoDashboard({ hojeIso, inicioMes, limite7Dias }),
    staleTime: 1000 * 60 * 5,
  });

  // Aliases de loading para manter compatibilidade com os Skeletons abaixo
  const loadingAlunos  = isLoading;
  const loadingPag     = isLoading;
  const loadingInadim  = isLoading;
  const loadingVencendo = isLoading;

  // ── Derivações ─────────────────────────────────────────────────────────────
  const faturamentoMes = useMemo(
    () => pagamentosMes.reduce((acc, m) => acc + Number(m.valor_pago), 0),
    [pagamentosMes]
  );

  const inadimplenciaTotal = useMemo(
    () => listaInadimplentes.reduce((acc, m) => acc + Number(m.valor_pago), 0),
    [listaInadimplentes]
  );

  const aniversariantesHoje     = useMemo(() => aniversariantesDoDia(todosAlunos), [todosAlunos]);
  const aniversariantesEmBreve  = useMemo(() => aniversariantesProximos(todosAlunos, 7), [todosAlunos]);

  const nomesMes = format(agora, 'MMMM', { locale: ptBR });
  const nomesMesCapitalizado = nomesMes.charAt(0).toUpperCase() + nomesMes.slice(1);

  const handleCobranca = (aluno, vencimento, valor) => {
    const data = format(new Date(vencimento + 'T12:00:00'), 'dd/MM/yyyy');
    const msg  = `Olá, ${aluno?.nome_completo?.split(' ')[0]}! Seu pagamento de ${formatarMoeda(valor)}, com vencimento em ${data}, ainda está em aberto. Podemos verificar juntos? 🙏`;
    window.open(gerarLinkWhatsApp(aluno?.telefone, msg), '_blank');
  };

  const handleParabens = (aluno) => {
    const msg = `Feliz aniversário, ${aluno.nome_completo?.split(' ')[0]}! 🎂 Toda a equipe do espaço deseja a você um dia incrível!`;
    window.open(gerarLinkWhatsApp(aluno.telefone, msg), '_blank');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8 space-y-6 animate-in fade-in duration-500 bg-background min-h-screen">

      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary-soft flex items-center justify-center">
              <Bell size={20} className="text-primary" />
            </div>
            Painel de Avisos
          </h1>
          <p className="text-muted-foreground font-medium mt-1">
            {format(agora, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
              .replace(/^./, c => c.toUpperCase())}
          </p>
        </div>
        <Link to="/resultado-financeiro">
          <Button variant="outline" size="sm" rightIcon={<ChevronRight size={16} />}>
            Ver DRE do mês
          </Button>
        </Link>
      </div>

      {/* Métricas rápidas do mês */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Surface variant="card" padding="lg" className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-success-soft flex items-center justify-center shrink-0">
            <Wallet size={20} className="text-success" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Receita {nomesMesCapitalizado}
            </p>
            {loadingPag
              ? <Skeleton className="h-6 w-24 mt-1" />
              : <p className="text-lg font-black text-foreground">{formatarMoeda(faturamentoMes)}</p>
            }
          </div>
        </Surface>

        <Surface variant="card" padding="lg" className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-brand-soft bg-primary-soft flex items-center justify-center shrink-0">
            <Users size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Alunos Ativos
            </p>
            {loadingAlunos
              ? <Skeleton className="h-6 w-16 mt-1" />
              : <p className="text-lg font-black text-foreground">{totalAlunos}</p>
            }
          </div>
        </Surface>

        <Surface variant="card" padding="lg" className="flex items-center gap-4 col-span-2 md:col-span-1">
          <div className="w-11 h-11 rounded-2xl bg-destructive-soft flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-destructive" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Em Atraso
            </p>
            {loadingInadim
              ? <Skeleton className="h-6 w-24 mt-1" />
              : (
                <p className="text-lg font-black text-destructive">
                  {listaInadimplentes.length} alunos
                </p>
              )
            }
          </div>
        </Surface>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Coluna esquerda */}
        <div className="space-y-6">

          {/* Pagamentos em atraso */}
          {loadingInadim ? (
            <Skeleton.Card />
          ) : listaInadimplentes.length > 0 ? (
            <SecaoAviso
              tipo="danger"
              icone={<AlertCircle size={18} />}
              titulo={`${listaInadimplentes.length} pagamento${listaInadimplentes.length > 1 ? 's' : ''} em atraso — ${formatarMoeda(inadimplenciaTotal)} em aberto`}
            >
              <div className="space-y-1">
                {listaInadimplentes.slice(0, 5).map(item => (
                  <CardAluno
                    key={item.id}
                    nome={item.alunos?.nome_completo}
                    info={`Venc: ${format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM/yyyy')} · ${formatarMoeda(item.valor_pago)}`}
                    acao={
                      item.alunos?.telefone && (
                        <button
                          onClick={() => handleCobranca(item.alunos, item.data_vencimento, item.valor_pago)}
                          className="text-xs bg-[#25D366] text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 hover:bg-[#20bd5a] transition-colors"
                        >
                          <MessageCircle size={13} /> Cobrar
                        </button>
                      )
                    }
                  />
                ))}
                {listaInadimplentes.length > 5 && (
                  <button
                    onClick={modalInadimplencia.abrir}
                    className="text-xs text-muted-foreground hover:text-foreground font-bold pt-2 flex items-center gap-1"
                  >
                    Ver mais {listaInadimplentes.length - 5} <ChevronRight size={13} />
                  </button>
                )}
              </div>
            </SecaoAviso>
          ) : (
            <SecaoAviso
              tipo="success"
              icone={<CheckCircle2 size={18} />}
              titulo="Nenhum pagamento em atraso 🎉"
            >
              <p className="text-sm text-success font-medium">
                Todos os alunos estão em dia com os pagamentos neste mês.
              </p>
            </SecaoAviso>
          )}

          {/* Planos vencendo em 7 dias */}
          {loadingVencendo ? (
            <Skeleton.Card />
          ) : alunosPlanosVencendo.length > 0 ? (
            <SecaoAviso
              tipo="warning"
              icone={<Clock size={18} />}
              titulo={`${alunosPlanosVencendo.length} plano${alunosPlanosVencendo.length > 1 ? 's' : ''} vencendo nos próximos 7 dias`}
            >
              <div className="space-y-1">
                {alunosPlanosVencendo.map(a => (
                  <CardAluno
                    key={a.id}
                    nome={a.nome_completo}
                    info={`Vence em ${format(new Date(a.data_fim_plano + 'T12:00:00'), 'dd/MM/yyyy')}`}
                    badge={
                      <Badge tone="warning">
                        {Math.ceil(
                          (new Date(a.data_fim_plano + 'T12:00:00') - agora) / (1000 * 60 * 60 * 24)
                        )}d
                      </Badge>
                    }
                  />
                ))}
              </div>
              <p className="text-xs text-warning font-medium mt-3">
                💡 Entre em contato para garantir a renovação antes do vencimento.
              </p>
            </SecaoAviso>
          ) : (
            <SecaoAviso
              tipo="info"
              icone={<CalendarCheck size={18} />}
              titulo="Nenhum plano vencendo esta semana"
            >
              <p className="text-sm text-info font-medium">
                Todos os planos têm vencimento além dos próximos 7 dias.
              </p>
            </SecaoAviso>
          )}
        </div>

        {/* Coluna direita */}
        <div className="space-y-6">

          {/* Aniversariantes hoje */}
          {aniversariantesHoje.length > 0 && (
            <SecaoAviso
              tipo="brand"
              icone={<Cake size={18} />}
              titulo={`🎂 ${aniversariantesHoje.length > 1 ? `${aniversariantesHoje.length} aniversariantes` : 'Aniversariante'} hoje!`}
            >
              <div className="space-y-1">
                {aniversariantesHoje.map(a => (
                  <CardAluno
                    key={a.id}
                    nome={a.nome_completo}
                    info={`${calcularIdade(a.data_nascimento)} anos hoje 🎉`}
                    acao={
                      a.telefone && (
                        <button
                          onClick={() => handleParabens(a)}
                          className="text-xs bg-[#25D366] text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 hover:bg-[#20bd5a] transition-colors"
                        >
                          <MessageCircle size={13} /> Parabéns
                        </button>
                      )
                    }
                  />
                ))}
              </div>
            </SecaoAviso>
          )}

          {/* Aniversariantes próximos 7 dias */}
          {aniversariantesEmBreve.length > 0 ? (
            <SecaoAviso
              tipo="info"
              icone={<Cake size={18} />}
              titulo={`${aniversariantesEmBreve.length} aniversário${aniversariantesEmBreve.length > 1 ? 's' : ''} nos próximos 7 dias`}
            >
              <div className="space-y-1">
                {aniversariantesEmBreve.map(a => {
                  const [, m, d] = a.data_nascimento.split('-').map(Number);
                  const dataAniv = new Date(agora.getFullYear(), m - 1, d);
                  return (
                    <CardAluno
                      key={a.id}
                      nome={a.nome_completo}
                      info={format(dataAniv, "dd 'de' MMMM", { locale: ptBR })}
                      badge={
                        <Badge tone="info">
                          {Math.ceil((dataAniv - agora) / (1000 * 60 * 60 * 24))}d
                        </Badge>
                      }
                      acao={
                        a.telefone && (
                          <button
                            onClick={() => handleParabens(a)}
                            className="text-xs bg-[#25D366] text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 hover:bg-[#20bd5a] transition-colors"
                          >
                            <MessageCircle size={13} />
                          </button>
                        )
                      }
                    />
                  );
                })}
              </div>
            </SecaoAviso>
          ) : aniversariantesHoje.length === 0 ? (
            <SecaoAviso
              tipo="info"
              icone={<Cake size={18} />}
              titulo="Nenhum aniversário nos próximos 7 dias"
            >
              <p className="text-sm text-info font-medium">
                Aproveite para checar os aniversários do mês na seção de Aniversariantes.
              </p>
            </SecaoAviso>
          ) : null}

          {/* Link rápido para DRE */}
          <Surface variant="card" padding="lg">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-primary-soft flex items-center justify-center shrink-0">
                <Wallet size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-black text-foreground text-sm">Resultado Financeiro</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Acesse o DRE completo com receitas, despesas, comissões e lucro líquido do mês.
                </p>
                <Link to="/resultado-financeiro">
                  <Button variant="brand" size="sm" rightIcon={<ChevronRight size={16} />}>
                    Ver DRE completo
                  </Button>
                </Link>
              </div>
            </div>
          </Surface>
        </div>
      </div>

      {/* Modal de inadimplência completo */}
      <Modal
        aberto={modalInadimplencia.aberto}
        fechar={modalInadimplencia.fechar}
        title="Pagamentos em Atraso"
        size="md"
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
          <div className="bg-destructive-soft border border-destructive/20 p-4 rounded-2xl flex justify-between items-center mb-2">
            <div>
              <p className="text-xs font-bold text-destructive">Total em atraso</p>
              <h3 className="text-2xl font-black text-destructive">{formatarMoeda(inadimplenciaTotal)}</h3>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-destructive">Alunos</p>
              <h3 className="text-2xl font-black text-destructive">{listaInadimplentes.length}</h3>
            </div>
          </div>
          {listaInadimplentes.map(item => (
            <div
              key={item.id}
              className="bg-card border border-border p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:border-destructive/30 transition-colors"
            >
              <div>
                <h4 className="font-bold text-foreground">{item.alunos?.nome_completo}</h4>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-md">
                    Venc: {format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM/yyyy')}
                  </span>
                  <span className="text-xs font-black text-destructive">
                    {formatarMoeda(item.valor_pago)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleCobranca(item.alunos, item.data_vencimento, item.valor_pago)}
                className="w-full sm:w-auto bg-[#25D366] text-white px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#20bd5a] transition-colors"
              >
                <MessageCircle size={16} /> Cobrar via WhatsApp
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}