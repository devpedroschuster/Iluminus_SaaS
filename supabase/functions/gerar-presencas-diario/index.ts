import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// =========================================================
// gerar-presencas-diario
//
// Roda 1x/dia (cron, sugerido às 22h) — chama fn_gerar_presencas_fixos
// para gerar as expectativas 'agendado' dos alunos fixos do dia seguinte.
//
// Roda também a cada hora (cron separado, mesma function, parâmetro
// diferente no body) — chama fn_detectar_faltas para marcar quem ficou
// 'agendado' sem check-in. Essa segunda chamada já enfileira a
// notificação de falta dentro da própria função SQL (migration 007).
//
// Configurar dois cron jobs no Supabase apontando pra esta function:
//   1. "0 1 * * *"  (22h BRT = 01h UTC) -> body: { "acao": "gerar_fixos" }
//   2. "0 * * * *"  (a cada hora)        -> body: { "acao": "detectar_faltas" }
// =========================================================

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body = {};
    try {
      body = await req.json();
    } catch {
      // sem body = assume gerar_fixos (comportamento padrão pro cron simples)
    }
    const acao = body?.acao ?? 'gerar_fixos';

    if (acao === 'gerar_fixos') {
      console.log("📅 Gerando presenças de alunos fixos...");

      const { data, error } = await supabase.rpc('fn_gerar_presencas_fixos');
      if (error) throw error;

      const resultado = data?.[0] ?? { geradas: 0, puladas_feriado: 0 };
      console.log(`✅ ${resultado.geradas} presenças geradas. Feriado: ${resultado.puladas_feriado ? 'sim' : 'não'}`);

      return new Response(JSON.stringify({ success: true, ...resultado }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (acao === 'detectar_faltas') {
      console.log("🔍 Detectando faltas...");

      const { data, error } = await supabase.rpc('fn_detectar_faltas', { p_margem_minutos: 60 });
      if (error) throw error;

      const resultado = data?.[0] ?? { faltas_marcadas: 0 };
      console.log(`⚠️ ${resultado.faltas_marcadas} faltas marcadas e enfileiradas para notificação.`);

      return new Response(JSON.stringify({ success: true, ...resultado }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Ação desconhecida: ${acao}` }), { status: 400 });

  } catch (err) {
    console.error("❌ Erro fatal:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})