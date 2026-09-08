import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ⚠️ Ajuste este valor para o domínio real do seu sistema em produção
// antes de fazer deploy. Usar '*' permite que QUALQUER site na internet
// chame esta função a partir do navegador de um usuário logado.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function resp(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ILU-32: senha temporária aleatória por conta, gerada aqui no servidor —
// nunca mais um valor fixo e público compartilhado por todas as contas
// novas (mesma abordagem já usada em gerenciar-acesso-professor).
function gerarSenhaTemporaria(length = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Cliente com privilégio total (ignora RLS) — só deve ser usado
  // DEPOIS de confirmarmos que quem chamou é um admin.
  const admin = createClient(supabaseUrl, serviceKey);

  // ── PASSO 1: AUTENTICAÇÃO + AUTORIZAÇÃO ─────────────────────────────────
  // ILU-32: esta função criava contas de autenticação sem checar quem
  // estava chamando (verify_jwt desligado). Qualquer pessoa com a URL
  // podia criar contas — agora exigimos token válido de um admin, no
  // mesmo padrão de gerenciar-acesso-professor.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return resp({ error: 'Não autenticado: token ausente' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return resp({ error: 'Não autenticado: token inválido' }, 401);
  }

  const { data: solicitante, error: perfilErr } = await admin
    .from('alunos')
    .select('role')
    .eq('auth_id', userData.user.id)
    .maybeSingle();

  if (perfilErr) {
    console.error('[criar_usuario] erro ao checar perfil:', perfilErr.message);
    return resp({ error: 'Erro ao validar permissões' }, 500);
  }

  if (solicitante?.role !== 'admin') {
    return resp({ error: 'Acesso negado: apenas administradores podem executar esta ação' }, 403);
  }

  // ── A PARTIR DAQUI, SABEMOS QUE QUEM CHAMOU É ADMIN ─────────────────────
  try {
    const { email, nome, role } = await req.json();
    if (!email) return resp({ error: 'email é obrigatório' }, 400);

    const emailNormalizado = email.trim().toLowerCase();
    const senhaTemporaria = gerarSenhaTemporaria();

    const { data, error } = await admin.auth.admin.createUser({
      email: emailNormalizado,
      password: senhaTemporaria,
      email_confirm: true,
      user_metadata: { nome_completo: nome, role },
    });
    if (error) throw error;

    // A senha temporária só é devolvida aqui, na resposta direta pro admin
    // que fez a ação (nunca logada, nunca salva em texto puro em lugar
    // nenhum). O front-end mostra isso uma única vez pro admin repassar ao
    // aluno com segurança, e o fluxo de login exige troca no primeiro acesso.
    return resp({ user: data.user, senha_temporaria: senhaTemporaria });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro interno';
    console.error('[criar_usuario]', msg);
    return resp({ error: msg }, 400);
  }
});
