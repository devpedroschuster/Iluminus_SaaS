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

async function enviarPush(supabase: any, professorId: string, title: string, body: string, url = '/agenda') {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('professor_id', professorId);

  if (!subs?.length) return { enviados: 0, expiradas: 0 };

  let enviados = 0;
  let expiradas = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({ title, body, url })
      );
      enviados++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // subscription expirada/revogada — remove para não tentar de novo
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        expiradas++;
      } else {
        console.error(`Erro ao enviar push para subscription ${sub.id}:`, err.message);
      }
    }
  }

  return { enviados, expiradas };
}

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@iluminus.com';

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: pendentes, error } = await supabase
      .from('notificacoes_pendentes')
      .select('*')
      .eq('processado', false)
      .order('criado_em', { ascending: true })
      .limit(200);

    if (error) throw error;

    if (!pendentes?.length) {
      console.log("😴 Nada pendente.");
      return new Response(JSON.stringify({ message: "Nada a processar" }), { status: 200 });
    }

    let totalEnviados = 0;
    let totalExpiradas = 0;
    const idsProcessados: string[] = [];

    // ---- Eventos imediatos: um push por evento ----
    const imediatos = pendentes.filter((p: any) => p.tipo !== 'aluno_agendado');
    for (const evento of imediatos) {
      const gerarMsg = MENSAGENS[evento.tipo];
      const body = gerarMsg ? gerarMsg(evento.payload ?? {}) : 'Sua agenda foi atualizada.';
      const { enviados, expiradas } = await enviarPush(
        supabase, evento.professor_id, tituloPara(evento.tipo), body
      );
      totalEnviados += enviados;
      totalExpiradas += expiradas;
      idsProcessados.push(evento.id);
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
        supabase, primeiro.professor_id, tituloPara('aluno_agendado'), body
      );
      totalEnviados += enviados;
      totalExpiradas += expiradas;
      idsProcessados.push(...eventosDoGrupo.map((e: any) => e.id));
    }

    // ---- Marca tudo como processado ----
    if (idsProcessados.length) {
      await supabase
        .from('notificacoes_pendentes')
        .update({ processado: true, processado_em: new Date().toISOString() })
        .in('id', idsProcessados);
    }

    console.log(`🚀 ${idsProcessados.length} eventos processados, ${totalEnviados} pushes enviados, ${totalExpiradas} subscriptions expiradas removidas.`);

    return new Response(JSON.stringify({
      eventosProcessados: idsProcessados.length,
      pushesEnviados: totalEnviados,
      subscriptionsExpiradas: totalExpiradas,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("❌ Erro fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})