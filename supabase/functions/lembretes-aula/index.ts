import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  try {
    console.log("🤖 Robô de Lembretes Iniciado!");

    // Conecta no banco de dados
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Calcula a data de amanhã
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const dataIso = amanha.toISOString().split('T')[0];
    console.log(`📅 Buscando aulas para o dia: ${dataIso}`);

    // Busca quem tem aula amanhã
    const { data: agendamentos, error } = await supabase
      .from('presencas')
      .select(`
        id,
        data_aula,
        agenda ( horario, atividade ),
        alunos ( push_token, nome_completo )
      `)
      .eq('data_aula', dataIso);

    if (error) throw error;

    if (!agendamentos || agendamentos.length === 0) {
      console.log("😴 Nenhuma aula agendada para amanhã.");
      return new Response(JSON.stringify({ message: "Nenhuma aula para amanhã" }), { status: 200 });
    }

    // Prepara a lista de mensagens para o Expo
    const notificacoes = [];

    for (const ag of agendamentos) {
      // Só cria a mensagem se o aluno tiver o token salvo
      if (ag.alunos?.push_token) {
        const primeiroNome = ag.alunos.nome_completo.split(' ')[0];
        const horario = ag.agenda.horario.substring(0, 5);

        notificacoes.push({
          to: ag.alunos.push_token,
          title: '🏋️ Lembrete Iluminus',
          body: `Olá, ${primeiroNome}! Sua aula de ${ag.agenda.atividade} é amanhã às ${horario}. Te esperamos!`,
          sound: 'default'
        });
      }
    }

    // Dispara tudo de uma vez para os servidores do Expo
    if (notificacoes.length > 0) {
      console.log(`🚀 Enviando ${notificacoes.length} notificações...`);
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notificacoes),
      });
    }

    return new Response(JSON.stringify({ success: true, enviados: notificacoes.length }), { 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (err) {
    console.error("❌ Erro fatal no robô:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})