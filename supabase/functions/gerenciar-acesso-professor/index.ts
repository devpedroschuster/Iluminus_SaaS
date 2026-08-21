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

// Gera uma senha temporária aleatória e segura (equivalente ao
// generateSecurePassword() do front-end, mas rodando no servidor,
// que é o Deno runtime — usamos a Web Crypto API, disponível nativamente).
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
  // Cliente "como o usuário", usando o token que veio na requisição.
  // Isso nos permite descobrir QUEM está chamando a função.
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

  // Confirma que o usuário autenticado é admin. No schema real do projeto,
  // o cargo de admin é modelado na tabela `alunos` (coluna `role`), não em
  // `professores` — confirmado via auditoria da função is_admin() no banco.
  const { data: solicitante, error: perfilErr } = await admin
    .from('alunos')
    .select('role')
    .eq('auth_id', userData.user.id)
    .maybeSingle();

  if (perfilErr) {
    console.error('[gerenciar-acesso-professor] erro ao checar perfil:', perfilErr.message);
    return resp({ error: 'Erro ao validar permissões' }, 500);
  }

  if (solicitante?.role !== 'admin') {
    return resp({ error: 'Acesso negado: apenas administradores podem executar esta ação' }, 403);
  }

  // ── A PARTIR DAQUI, SABEMOS QUE QUEM CHAMOU É ADMIN ─────────────────────
  try {
    const { acao, professor_id, auth_id, email, nome } = await req.json();

    // ── CRIAR ────────────────────────────────────────────────────────────────
    if (acao === 'criar') {
      if (!email) return resp({ error: 'email é obrigatório' }, 400);

      const emailNormalizado = email.trim().toLowerCase();

      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw listErr;

      const existente = users.find((u) => u.email === emailNormalizado);

      let novoAuthId: string;
      let reutilizado = false;
      let senhaTemporaria: string | null = null;

      if (existente) {
        novoAuthId = existente.id;
        reutilizado = true;
      } else {
        // PASSO 2: senha aleatória por chamada, nunca mais um valor fixo.
        senhaTemporaria = gerarSenhaTemporaria();
        const { data, error } = await admin.auth.admin.createUser({
          email: emailNormalizado,
          password: senhaTemporaria,
          email_confirm: true,
          user_metadata: { nome, role: 'professor' },
        });
        if (error) throw error;
        novoAuthId = data.user.id;
      }

      if (professor_id) {
        const { error: upErr } = await admin
          .from('professores')
          .update({
            auth_id: novoAuthId,
            email: emailNormalizado,
            primeiro_acesso: !reutilizado,
          })
          .eq('id', professor_id);
        if (upErr) throw upErr;
      }

      // A senha temporária só é retornada aqui, na resposta direta pro admin
      // que fez a ação (nunca logada, nunca salva em texto puro em lugar nenhum).
      // O front-end deve mostrar isso uma única vez pro admin copiar/repassar
      // ao professor com segurança (ex.: por WhatsApp direto), e o fluxo de
      // login deve obrigar troca de senha por causa de `primeiro_acesso: true`.
      return resp({ auth_id: novoAuthId, reutilizado, senha_temporaria: senhaTemporaria });
    }

    // ── REMOVER ───────────────────────────────────────────────────────────────
    if (acao === 'remover') {
      if (!auth_id || !professor_id) return resp({ error: 'auth_id e professor_id são obrigatórios' }, 400);

      const { data: aluno } = await admin
        .from('alunos')
        .select('id')
        .eq('auth_id', auth_id)
        .maybeSingle();

      let userDeletado = false;
      if (!aluno) {
        const { error: delErr } = await admin.auth.admin.deleteUser(auth_id);
        if (delErr && !delErr.message.includes('User not found')) throw delErr;
        userDeletado = true;
      }

      const { error: upErr } = await admin
        .from('professores')
        .update({ auth_id: null, email: null, primeiro_acesso: false })
        .eq('id', professor_id);
      if (upErr) throw upErr;

      return resp({ removido: true, user_deletado: userDeletado });
    }

    // ── TROCAR EMAIL ──────────────────────────────────────────────────────────
    if (acao === 'trocar_email') {
      if (!auth_id || !email || !professor_id) {
        return resp({ error: 'auth_id, email e professor_id são obrigatórios' }, 400);
      }

      const { data: aluno } = await admin
        .from('alunos')
        .select('id')
        .eq('auth_id', auth_id)
        .maybeSingle();

      if (!aluno) {
        const { error: delErr } = await admin.auth.admin.deleteUser(auth_id);
        if (delErr && !delErr.message.includes('User not found')) throw delErr;
      }

      const emailNormalizado = email.trim().toLowerCase();
      const { data: { users }, error: listErr2 } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr2) throw listErr2;
      const existente = users.find((u) => u.email === emailNormalizado);

      let novoAuthId: string;
      let reutilizado = false;
      let senhaTemporaria: string | null = null;

      if (existente) {
        novoAuthId = existente.id;
        reutilizado = true;
      } else {
        senhaTemporaria = gerarSenhaTemporaria();
        const { data, error } = await admin.auth.admin.createUser({
          email: emailNormalizado,
          password: senhaTemporaria,
          email_confirm: true,
          user_metadata: { nome, role: 'professor' },
        });
        if (error) throw error;
        novoAuthId = data.user.id;
      }

      const { error: upErr } = await admin
        .from('professores')
        .update({
          auth_id: novoAuthId,
          email: emailNormalizado,
          primeiro_acesso: !reutilizado,
        })
        .eq('id', professor_id);
      if (upErr) throw upErr;

      return resp({ auth_id: novoAuthId, reutilizado, senha_temporaria: senhaTemporaria });
    }

    return resp({ error: `Ação desconhecida: ${acao}` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno';
    console.error('[gerenciar-acesso-professor]', msg);
    return resp({ error: msg }, 500);
  }
});