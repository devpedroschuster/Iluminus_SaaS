import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "npm:web-push@3"

// =========================================================
// processar-notificacoes
//
// Roda a cada 1-2 min (cron) — consome notificacoes_pendentes e envia
// Web Push para os professores via push_subscriptions.
//
// Eventos imediatos (1 notificação por evento):
//   horario_alterado, aula_cancelada, professor_alterado,
//   aluno_falta, agendamento_removido
//
// Evento agregado (agrupado por aula antes de notificar):
//   aluno_agendado -> "3 novos alunos confirmados na sua aula de ..."
//
// Requer variáveis de ambiente:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex: mailto:contato@...)
// =========================================================

const MENSAGENS: Record<string, (p: any) => string> = {
  horario_alterado: (p) =>
    `O horário da aula de ${p.atividade ?? 'sua turma'} foi alterado para ${p.horario_novo ?? p.horario ?? '—'}.`,
  aula_cancelada: (p) =>
    `A aula de ${p.atividade ?? 'sua turma'} foi cancelada/encerrada.`,
  professor_alterado: (p) =>
    `Você foi atribuído a uma nova aula: ${p.atividade ?? '—'} às ${p.horario ?? '—'}.`,
  aluno_falta: (p) =>
    `Falta registrada na aula de ${p.atividade ?? 'sua turma'} (${p.data_aula ?? ''}).`,
  agendamento_removido: (p) =>
    `Um agendamento foi removido da sua aula de ${p.atividade ?? 'sua turma'} (${p.data_aula ?? ''}).`,
};

function tituloPara(tipo: string): string {
  if (tipo === 'aula_cancelada') return '❌ Aula cancelada';
  if (tipo === 'horario_alterado') return '🕐 Horário alterado';
  if (tipo === 'professor_alterado') return '📋 Nova aula atribuída';
  if (tipo === 'aluno_falta') return '⚠️ Falta registrada';
  if (tipo === 'agendamento_removido') return '✋ Agendamento removido';
  if (tipo === 'aluno_agendado') return '✅ Novos agendamentos';
  return '📅 Atualização na agenda';
}

// ILU-15: `subs` agora é passado pelo chamador (pré-carregado em lote para
// todos os professores envolvidos na execução) em vez de cada chamada de
// enviarPush buscar suas próprias subscriptions — eliminava um round-trip ao
// banco por notificação (N+1). Os envios para as subscriptions de UM mesmo
// professor agora rodam em paralelo via Promise.allSettled em vez de um `for`
// sequencial, já que são independentes entre si.
async function enviarPush(supabase: any, subs: any[], title: string, body: string, url = '/agenda') {
  if (!subs?.length) return { enviados: 0, expiradas: 0 };

  const resultados = await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({ title, body, url }))
        .then(() => ({ sub, expirada: false }))
        .catch((err: any) => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            return { sub, expirada: true };
          }
          console.error(`Erro ao enviar push para subscription ${sub.id}:`, err.message);
          throw err;
        })
    )
  );

  let enviados = 0;
  const idsExpirados: string[] = [];

  for (const r of resultados) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.expirada) {
      idsExpirados.push(r.value.sub.id);
    } else {
      enviados++;
    }
  }

  if (idsExpirados.length > 0) {
    // subscriptions expiradas/revogadas — remove para não tentar de novo
    await supabase.from('push_subscriptions').delete().in('id', idsExpirados);
  }

  return { enviados, expiradas: idsExpirados.length };
}

serve(async (req) => {
  // ── AUTORIZAÇÃO (ILU-10) ───────────────────────────────────────────────────
  // Função só deve rodar via cron. Chamada direta por usuário autenticado
  // causaria envio de push duplicado/fora de hora para professores (spam).
  // Exige um segredo compartilhado que só o job de cron conhece, enviado
  // como header `x-cron-secret`.
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@iluminus.com';

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    // ── RESERVA ATÔMICA (ILU-15) ─────────────────────────────────────────────
    // Antes, as linhas eram lidas (processado=false), processadas e só
    // marcadas como processado=true no FINAL — sem nenhum passo de "reservar"
    // antes de processar. Se duas execuções se sobrepusessem (cron normal +
    // uma chamada manual, ou um cron run mais lento que o intervalo do
    // próximo), ambas liam as mesmas linhas não processadas e enviavam push
    // duplicado antes de qualquer uma marcar as linhas como concluídas.
    // Agora a reserva é um único UPDATE ... WHERE processado = false RETURNING
    // *: como uma linha só pode ser atualizada por uma transação de cada vez,
    // se duas execuções tentarem reservar a mesma linha, a segunda UPDATE
    // reavalia o WHERE após a primeira commitar, vê processado=true e não a
    // inclui no RETURNING — cada linha é processada por, no máximo, uma
    // execução.
    const { data: candidatos, error: errCandidatos } = await supabase
      .from('notificacoes_pendentes')
      .select('id')
      .eq('processado', false)
      .order('criado_em', { ascending: true })
      .limit(200);

    if (errCandidatos) throw errCandidatos;

    if (!candidatos?.length) {
      console.log("😴 Nada pendente.");
      return new Response(JSON.stringify({ message: "Nada a processar" }), { status: 200 });
    }

    const { data: pendentes, error: errReserva } = await supabase
      .from('notificacoes_pendentes')
      .update({ processado: true, processado_em: new Date().toISOString() })
      .in('id', candidatos.map((c: any) => c.id))
      .eq('processado', false)
      .select('*');

    if (errReserva) throw errReserva;

    if (!pendentes?.length) {
      // Outra execução reservou todas as linhas candidatas primeiro.
      console.log("😴 Nada reservado (concorrência com outra execução).");
      return new Response(JSON.stringify({ message: "Nada a processar" }), { status: 200 });
    }

    // ── PRÉ-CARREGA SUBSCRIPTIONS (ILU-15) ───────────────────────────────────
    // Antes, `enviarPush` consultava `push_subscriptions` uma vez por
    // notificação (N+1). Agora busca de uma vez só as subscriptions de todos
    // os professores envolvidos nesta execução.
    const professorIds = [...new Set(pendentes.map((p: any) => p.professor_id))];
    const { data: todasSubs, error: errSubs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('professor_id', professorIds);

    if (errSubs) throw errSubs;

    const subsPorProfessor = new Map<string, any[]>();
    for (const sub of todasSubs ?? []) {
      if (!subsPorProfessor.has(sub.professor_id)) subsPorProfessor.set(sub.professor_id, []);
      subsPorProfessor.get(sub.professor_id)!.push(sub);
    }

    let totalEnviados = 0;
    let totalExpiradas = 0;
    let eventosProcessados = 0;

    // ---- Eventos imediatos: um push por evento ----
    const imediatos = pendentes.filter((p: any) => p.tipo !== 'aluno_agendado');
    for (const evento of imediatos) {
      const gerarMsg = MENSAGENS[evento.tipo];
      const body = gerarMsg ? gerarMsg(evento.payload ?? {}) : 'Sua agenda foi atualizada.';
      const { enviados, expiradas } = await enviarPush(
        supabase, subsPorProfessor.get(evento.professor_id) ?? [], tituloPara(evento.tipo), body
      );
      totalEnviados += enviados;
      totalExpiradas += expiradas;
      eventosProcessados++;
    }

    // ---- Evento agregado: aluno_agendado agrupado por aula+professor+data ----
    const agendamentos = pendentes.filter((p: any) => p.tipo === 'aluno_agendado');
    const grupos = new Map<string, any[]>();
    for (const ev of agendamentos) {
      const dataAula = ev.payload?.data_aula ?? 'sem-data';
      const chave = `${ev.professor_id}-${ev.aula_id}-${dataAula}`;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)!.push(ev);
    }

    for (const [, eventosDoGrupo] of grupos) {
      const primeiro = eventosDoGrupo[0];
      const atividade = primeiro.payload?.atividade ?? 'sua turma';
      const dataAula = primeiro.payload?.data_aula;
      const qtd = eventosDoGrupo.length;
      const body = qtd === 1
        ? `1 novo aluno confirmado na sua aula de ${atividade}${dataAula ? ` (${dataAula})` : ''}.`
        : `${qtd} novos alunos confirmados na sua aula de ${atividade}${dataAula ? ` (${dataAula})` : ''}.`;

      const { enviados, expiradas } = await enviarPush(
        supabase, subsPorProfessor.get(primeiro.professor_id) ?? [], tituloPara('aluno_agendado'), body
      );
      totalEnviados += enviados;
      totalExpiradas += expiradas;
      eventosProcessados += eventosDoGrupo.length;
    }

    console.log(`🚀 ${eventosProcessados} eventos processados, ${totalEnviados} pushes enviados, ${totalExpiradas} subscriptions expiradas removidas.`);

    return new Response(JSON.stringify({
      eventosProcessados,
      pushesEnviados: totalEnviados,
      subscriptionsExpiradas: totalExpiradas,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("❌ Erro fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})