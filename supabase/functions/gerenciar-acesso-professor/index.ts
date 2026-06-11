// supabase/functions/gerenciar-acesso-professor/index.ts
//
// Gerencia o ciclo de vida do acesso (auth.users) de um professor.
//
// Ações:
//   criar        — cria novo user no auth e retorna { user }
//   remover      — deleta o user do auth (requer auth_id)
//   trocar_email — deleta o user antigo e cria um novo (requer auth_id + novo_email)
//
// Todos os casos atualizam auth_id na tabela professores atomicamente.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

      // Verifica se já existe um auth user com esse email
      const emailNormalizado = email.trim().toLowerCase();
      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw listErr;

      const existente = users.find((u) => u.email === emailNormalizado);

      let novoAuthId: string;

      if (existente) {
        novoAuthId = existente.id;
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(emailNormalizado, {
          data: { nome, role: 'professor' },
        });
        if (error) throw error;
        novoAuthId = data.user.id;
      }

      // Atualiza professores.auth_id
      const { error: upErr } = await admin
        .from('professores')
        .update({ auth_id: novoAuthId, email: emailNormalizado })
        .eq('id', professor_id);
      if (upErr) throw upErr;

      return resp({ auth_id: novoAuthId, reutilizado: !!existente });
    }

    // ── REMOVER ───────────────────────────────────────────────────────────────
    if (acao === 'remover') {
      if (!auth_id || !professor_id) return resp({ error: 'auth_id e professor_id são obrigatórios' }, 400);

      // Verifica se o mesmo auth_id está vinculado a um aluno — nesse caso NÃO deleta o user,
      // apenas desvincula do professor (o aluno continua existindo)
      const { data: aluno } = await admin
        .from('alunos')
        .select('id')
        .eq('auth_id', auth_id)
        .maybeSingle();

      let userDeletado = false;
      if (!aluno) {
        // Sem vínculo com aluno → tenta deletar do auth
        const { error: delErr } = await admin.auth.admin.deleteUser(auth_id);
        if (delErr && !delErr.message.includes('User not found')) {
          throw delErr;
        }
        userDeletado = true;
      }

      // De qualquer forma, limpa auth_id e email do professor
      const { error: upErr } = await admin
        .from('professores')
        .update({ auth_id: null, email: null })
        .eq('id', professor_id);
      if (upErr) throw upErr;

      return resp({ removido: true, user_deletado: userDeletado });
    }

    // ── TROCAR EMAIL ──────────────────────────────────────────────────────────
    if (acao === 'trocar_email') {
      if (!auth_id || !email || !professor_id) {
        return resp({ error: 'auth_id, email e professor_id são obrigatórios' }, 400);
      }

      // 1. Remove o acesso antigo (reutiliza lógica acima via chamada interna)
      const { data: aluno } = await admin
        .from('alunos')
        .select('id')
        .eq('auth_id', auth_id)
        .maybeSingle();

      if (!aluno) {
        const { error: delErr } = await admin.auth.admin.deleteUser(auth_id);
        if (delErr && !delErr.message.includes('User not found')) {
          throw delErr;
        }
      }

      // 2. Cria novo user com o novo email (ou reusa existente)
      const emailNormalizado = email.trim().toLowerCase();
      const { data: { users }, error: listErr2 } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr2) throw listErr2;
      const existente = users.find((u) => u.email === emailNormalizado);

      let novoAuthId: string;
      if (existente) {
        novoAuthId = existente.id;
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(emailNormalizado, {
          data: { nome, role: 'professor' },
        });
        if (error) throw error;
        novoAuthId = data.user.id;
      }

      // 3. Atualiza professor com novo auth_id e email
      const { error: upErr } = await admin
        .from('professores')
        .update({ auth_id: novoAuthId, email: email.trim().toLowerCase() })
        .eq('id', professor_id);
      if (upErr) throw upErr;

      return resp({ auth_id: novoAuthId, reutilizado: !!existente });
    }

    return resp({ error: `Ação desconhecida: ${acao}` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno';
    console.error('[gerenciar-acesso-professor]', msg);
    return resp({ error: msg }, 500);
  }
});