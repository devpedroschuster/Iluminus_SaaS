import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SENHA_PADRAO = 'Iluminus576';

function resp(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    const { acao, professor_id, auth_id, email, nome } = await req.json();

    // ── CRIAR ────────────────────────────────────────────────────────────────
    if (acao === 'criar') {
      if (!email || !professor_id) return resp({ error: 'email e professor_id são obrigatórios' }, 400);

      const emailNormalizado = email.trim().toLowerCase();

      // Verifica se já existe um auth user com esse email
      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw listErr;

      const existente = users.find((u) => u.email === emailNormalizado);

      let novoAuthId: string;
      let reutilizado = false;

      if (existente) {
        // Usuário já existe: apenas vincula, não cria nem reseta senha
        novoAuthId = existente.id;
        reutilizado = true;
      } else {
        // Cria usuário com senha padrão + primeiro_acesso via user_metadata
        const { data, error } = await admin.auth.admin.createUser({
          email: emailNormalizado,
          password: SENHA_PADRAO,
          email_confirm: true,           // pula confirmação por email
          user_metadata: { nome, role: 'professor' },
        });
        if (error) throw error;
        novoAuthId = data.user.id;
      }

      // Atualiza professores: auth_id, email e primeiro_acesso = true
      const { error: upErr } = await admin
        .from('professores')
        .update({
          auth_id: novoAuthId,
          email: emailNormalizado,
          primeiro_acesso: !reutilizado, // só marca primeiro_acesso para usuários novos
        })
        .eq('id', professor_id);
      if (upErr) throw upErr;

      return resp({ auth_id: novoAuthId, reutilizado });
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

      if (existente) {
        novoAuthId = existente.id;
        reutilizado = true;
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          email: emailNormalizado,
          password: SENHA_PADRAO,
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

      return resp({ auth_id: novoAuthId, reutilizado });
    }

    return resp({ error: `Ação desconhecida: ${acao}` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno';
    console.error('[gerenciar-acesso-professor]', msg);
    return resp({ error: msg }, 500);
  }
});