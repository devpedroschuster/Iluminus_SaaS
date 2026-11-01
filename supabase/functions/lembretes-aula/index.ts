import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  // ── AUTORIZAÇÃO (ILU-10) ───────────────────────────────────────────────────
  // Função só deve rodar via cron. Chamada direta por usuário autenticado
  // causaria envio de notificação push duplicado/fora de hora para alunos.
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
    console.log("🤖 Robô de Lembretes Iniciado!");

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const dataIso = amanha.toISOString().split('T')[0];
    console.log(`📅 Buscando aulas para o dia: ${dataIso}`);

    // `aluno_id`/`aula_id` em `presencas` são FKs para-um (belongs-to), então
    // em runtime o PostgREST retorna `agenda`/`alunos` como objeto único, não
    // array — mas sem o client tipado com `Database`, a inferência de tipos
    // do supabase-js não sabe disso e assume array por padrão (ILU-54).
    // `.returns<T>()` corrige só o tipo, sem alterar o shape real da resposta.
    interface Agendamento {
      id: number;
      data_aula: string;
      agenda: { horario: string; atividade: string } | null;
      alunos: { push_token: string | null; nome_completo: string | null } | null;
    }

    const { data: agendamentos, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_aula,
        agenda ( horario, atividade ),
        alunos ( push_token, nome_completo )
      `)
      .eq('data_aula', dataIso)
      .in('status', ['agendado', 'presente']) // exclui falta/cancelado — não faz sentido lembrar quem já não vai
      .returns<Agendamento[]>();

    if (error) throw error;

    if (!agendamentos || agendamentos.length === 0) {
      console.log("😴 Nenhuma aula agendada para amanhã.");
      return new Response(JSON.stringify({ message: "Nenhuma aula para amanhã" }), { status: 200 });
    }

    const notificacoes = [];

    // ILU-14: `.horario`/`.atividade` agora são acessados com optional
    // chaining — uma linha de `presencas` com `agenda` órfã/incompleta
    // (aula excluída depois que a presença foi criada, inconsistência de
    // dados) é logada e pulada, em vez de lançar um TypeError que abortava
    // a function inteira com 500 (zero lembretes para TODOS os alunos do
    // dia, não só o registro problemático).
    for (const ag of agendamentos) {
      if (!ag.alunos?.push_token) continue;

      const horario = ag.agenda?.horario?.substring(0, 5);
      if (!horario || !ag.agenda?.atividade) {
        console.warn(`⚠️ Presença ${ag.id} sem agenda/horário válido — lembrete pulado.`);
        continue;
      }

      const primeiroNome = (ag.alunos.nome_completo ?? '').split(' ')[0];

      notificacoes.push({
        to: ag.alunos.push_token,
        title: '🏋️ Lembrete Iluminus',
        body: `Olá, ${primeiroNome}! Sua aula de ${ag.agenda.atividade} é amanhã às ${horario}. Te esperamos!`,
        sound: 'default'
      });
    }

    if (notificacoes.length > 0) {
      console.log(`🚀 Enviando ${notificacoes.length} notificações...`);
      // ILU-14 (bônus): a Expo retorna 200 mesmo com falhas parciais — o
      // resultado por ticket vem no corpo da resposta, não no status HTTP.
      // Sem checar `res.ok` nem ler o corpo, tokens inválidos/expirados
      // falhavam silenciosamente e a function reportava `success: true`
      // mesmo quando nenhum push foi realmente entregue.
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notificacoes),
      });

      if (!res.ok) {
        console.error(`❌ Expo push API respondeu ${res.status}: ${await res.text()}`);
      } else {
        const corpo = await res.json();
        const tickets = Array.isArray(corpo?.data) ? corpo.data : [];
        const falhas = tickets.filter((t: { status?: string }) => t.status === 'error');
        if (falhas.length > 0) {
          console.error(`❌ ${falhas.length}/${tickets.length} tickets de push falharam:`, JSON.stringify(falhas));
        }
      }
    }

    return new Response(JSON.stringify({ success: true, enviados: notificacoes.length }), { 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (err) {
    console.error("❌ Erro fatal no robô:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
})