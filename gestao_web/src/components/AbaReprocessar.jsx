// ─── ARQUIVO 1: src/components/AbaReprocessar.jsx (novo arquivo) ─────────────
//
// Aba "Reprocessar Repasses" na página de Comissões.
// Lista mensalidades pagas no mês selecionado e permite re-invocar
// gerar-repasses individualmente para corrigir lançamentos desatualizados.

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, User, Calendar } from 'lucide-react';

import { supabase } from '../lib/supabase'; // ajuste o caminho se necessário
import { reprocessarRepasse } from '../services/repasseService';
import { showToast } from '../components/shared/Toast';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import Surface from '../components/ui/Surface';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { formatarMoeda } from '../lib/utils';

// ─── helpers locais ───────────────────────────────────────────────────────────

function formatarData(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('T')[0].split('-');
  return `${dia}/${mes}/${ano}`;
}

const TIPO_LABELS = {
  regular: 'Regular',
  plano_livre: 'Plano Livre',
  avulsa: 'Avulsa',
  experimental: 'Experimental',
};

const TIPO_TONE = {
  regular: 'brand',
  plano_livre: 'info',
  avulsa: 'warning',
  experimental: 'purple',
};

// ─── linha da tabela ──────────────────────────────────────────────────────────

function LinhaMensalidade({ mensalidade, onReprocessado }) {
  const [status, setStatus] = useState('idle'); // idle | loading | ok | erro
  const [resultado, setResultado] = useState(null);

  async function handleReprocessar() {
    setStatus('loading');
    setResultado(null);
    try {
      const data = await reprocessarRepasse(String(mensalidade.id));
      setResultado(data);
      setStatus('ok');
      showToast.success(
        `${data.gerados} repasse(s) reprocessado(s) para ${mensalidade.alunos?.nome_completo}.`,
      );
      onReprocessado?.();
    } catch (err) {
      console.error('[AbaReprocessar]', err);
      setStatus('erro');
      showToast.error(err?.message || 'Erro ao reprocessar repasse.');
    }
  }

  return (
    <tr className="hover:bg-subtle transition-colors border-b border-border last:border-0">
      {/* Aluno */}
      <td className="p-4">
        <div className="flex items-center gap-2">
          <User size={14} className="text-muted-foreground shrink-0" />
          <span className="font-bold text-foreground">
            {mensalidade.alunos?.nome_completo || 'N/A'}
          </span>
        </div>
      </td>

      {/* Pagamento */}
      <td className="p-4 text-muted-foreground font-medium">
        {formatarData(mensalidade.data_pagamento || mensalidade.data_vencimento)}
      </td>

      {/* Tipo */}
      <td className="p-4">
        <Badge tone={TIPO_TONE[mensalidade.tipo_aula] ?? 'neutral'} variant="soft">
          {TIPO_LABELS[mensalidade.tipo_aula] ?? mensalidade.tipo_aula ?? '—'}
        </Badge>
      </td>

      {/* Valor */}
      <td className="p-4 font-black text-foreground text-right">
        {formatarMoeda(mensalidade.valor_pago)}
      </td>

      {/* Lançamentos atuais */}
      <td className="p-4 text-center">
        {status === 'ok' && resultado ? (
          <span className="text-success font-bold text-sm">{resultado.gerados}</span>
        ) : (
          <span className="text-muted-foreground font-medium text-sm">
            {mensalidade.qtd_lancamentos ?? '—'}
          </span>
        )}
      </td>

      {/* Ação */}
      <td className="p-4 text-right">
        {status === 'ok' ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
            <CheckCircle size={14} /> Reprocessado
          </span>
        ) : status === 'erro' ? (
          <button
            onClick={handleReprocessar}
            className="inline-flex items-center gap-1 text-xs font-bold text-destructive hover:underline"
          >
            <AlertTriangle size={14} /> Tentar novamente
          </button>
        ) : (
          <Button
            variant="outline"
            onClick={handleReprocessar}
            disabled={status === 'loading'}
            className="text-xs h-8 px-3 font-bold gap-1.5"
          >
            <RefreshCw size={13} className={status === 'loading' ? 'animate-spin' : ''} />
            {status === 'loading' ? 'Reprocessando…' : 'Reprocessar'}
          </Button>
        )}
      </td>
    </tr>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function AbaReprocessar({ mesAno }) {
  const [mensalidades, setMensalidades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [reprocessandoTodos, setReprocessandoTodos] = useState(false);

  const carregarMensalidades = useCallback(async () => {
    if (!mesAno) return;
    setLoading(true);
    setErro(null);

    // Primeiro dia e último dia do mês
    const [ano, mes] = mesAno.split('-').map(Number);
    const inicio = `${mesAno}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesAno}-${String(ultimoDia).padStart(2, '0')}`;

    try {
      // Busca mensalidades pagas no mês com join no aluno
      // e conta quantos lançamentos de repasse cada uma tem
      const { data, error } = await supabase
        .from('mensalidades')
        .select(`
          id,
          aluno_id,
          tipo_aula,
          valor_pago,
          data_pagamento,
          data_vencimento,
          alunos ( nome_completo ),
          repasses_lancamentos ( id )
        `)
        .eq('status', 'pago')
        .not('aluno_id', 'is', null)
        .gte('data_pagamento', inicio)
        .lte('data_pagamento', fim)
        .order('data_pagamento', { ascending: false });

      if (error) throw error;

      // Agrega a contagem de lançamentos
      const comContagem = (data ?? []).map(m => ({
        ...m,
        qtd_lancamentos: m.repasses_lancamentos?.length ?? 0,
      }));

      setMensalidades(comContagem);
    } catch (err) {
      console.error('[AbaReprocessar] carregarMensalidades:', err);
      setErro('Erro ao carregar mensalidades. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [mesAno]);

  useEffect(() => {
    carregarMensalidades();
  }, [carregarMensalidades]);

  async function handleReprocessarTodos() {
    if (mensalidades.length === 0) return;
    setReprocessandoTodos(true);

    let sucessos = 0;
    let falhas = 0;

    for (const m of mensalidades) {
      try {
        await reprocessarRepasse(String(m.id));
        sucessos++;
      } catch {
        falhas++;
      }
    }

    setReprocessandoTodos(false);

    if (falhas === 0) {
      showToast.success(`${sucessos} mensalidade(s) reprocessada(s) com sucesso.`);
    } else {
      showToast.error(`${sucessos} ok, ${falhas} com erro. Reprocesse individualmente os que falharam.`);
    }

    // Recarrega para atualizar contagens
    carregarMensalidades();
  }

  const mesFormatado = mesAno.split('-').reverse().join('/');

  return (
    <div className="space-y-6">
      {/* Cabeçalho explicativo */}
      <Surface variant="subtle" className="border border-warning/20 bg-warning-soft p-4 rounded-2xl flex items-start gap-3">
        <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-warning text-sm">Quando usar esta aba?</p>
          <p className="text-sm text-warning/80 mt-0.5">
            Use quando um aluno teve sua matrícula atualizada <strong>após</strong> confirmar o
            pagamento, ou quando um repasse gerou menos lançamentos do que o esperado.
            Reprocessar é seguro e idempotente — apaga os lançamentos anteriores da mensalidade
            e recria com base no estado atual do aluno.
          </p>
        </div>
      </Surface>

      {/* Tabela */}
      <Surface variant="card" padding="none" className="overflow-hidden">
        <div className="p-6 border-b border-border bg-muted/30 flex items-center justify-between">
          <div>
            <h3 className="font-black text-foreground text-lg flex items-center gap-2">
              <RefreshCw className="text-primary" size={20} />
              Mensalidades Pagas — {mesFormatado}
            </h3>
            {!loading && mensalidades.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {mensalidades.length} mensalidade(s) encontrada(s)
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={carregarMensalidades}
              disabled={loading}
              className="h-9 px-3 font-bold gap-1.5 text-sm"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </Button>
            {mensalidades.length > 1 && (
              <Button
                variant="brand"
                onClick={handleReprocessarTodos}
                disabled={reprocessandoTodos || loading}
                className="h-9 px-4 font-bold gap-1.5 text-sm"
              >
                <RefreshCw size={14} className={reprocessandoTodos ? 'animate-spin' : ''} />
                {reprocessandoTodos ? 'Reprocessando…' : 'Reprocessar Todos'}
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-6"><TableSkeleton /></div>
        ) : erro ? (
          <div className="p-8 flex items-center gap-3 text-destructive">
            <AlertTriangle size={18} />
            <span className="text-sm font-bold">{erro}</span>
          </div>
        ) : mensalidades.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<Calendar size={28} />}
              titulo="Nenhuma mensalidade paga"
              mensagem={`Não há mensalidades com status "pago" em ${mesFormatado}.`}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Aluno</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Pagamento</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Valor</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center">Lançamentos</th>
                  <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {mensalidades.map(m => (
                  <LinhaMensalidade
                    key={m.id}
                    mensalidade={m}
                    onReprocessado={carregarMensalidades}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}


// ─── ARQUIVO 2: alterações em Comissoes.jsx ───────────────────────────────────
//
// 1. Adicione o import no topo do arquivo:
//
//    import AbaReprocessar from '../components/AbaReprocessar';
//
// 2. Substitua o array de tabs (por volta da linha 883) por:
//
//    {[
//      { id: 'geral',        label: 'Visão Geral',           icon: LayoutGrid  },
//      { id: 'detalhe',      label: 'Detalhe por Professor', icon: UserCheck   },
//      { id: 'reprocessar',  label: 'Reprocessar Repasses',  icon: RefreshCw   },
//    ].map(tab => { ... })}
//
// 3. Substitua o bloco de conteúdo das abas (por volta da linha 909) por:
//
//    {aba === 'geral' ? (
//      <AbaVisaoGeral
//        mesAno={filtros.mesAno}
//        onSelecionarProfessor={handleSelecionarProfessor}
//      />
//    ) : aba === 'detalhe' ? (
//      <AbaDetalhe
//        professores={professores}
//        filtros={filtros}
//        setFiltros={setFiltros}
//      />
//    ) : (
//      <AbaReprocessar mesAno={filtros.mesAno} />
//    )}