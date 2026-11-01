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
    const { acao, aluno_id, email, nome, role } = await req.json();

    // As ações por aluno_id só gerenciam contas de aluno: trocar a senha de
    // um administrador por aqui (a rota /alunos/:id também abre admins)
    // derrubaria a sessão dele.
    const MSG_NAO_ALUNO = 'Acesso de administrador não é gerenciado por aqui.';

    // ── ILU-76: CRIAR ACESSO PARA ALUNO JÁ CADASTRADO ────────────────────
    // O login é criado e vinculado aqui, pelo id do aluno. Os metadados NÃO
    // levam `role: 'aluno'`: o trigger cria_perfil_automatico só age nesse
    // caso e vincula por e-mail OU nome (ILU-86 — homônimos dividiriam a
    // conta; e-mail com maiúscula gerava aluno duplicado).
    if (acao === 'criar') {
      if (aluno_id == null) return resp({ error: 'aluno_id é obrigatório' }, 400);

      const { data: aluno, error: alunoErr } = await admin
        .from('alunos')
        .select('id, email, nome_completo, auth_id, role')
        .eq('id', aluno_id)
        .maybeSingle();
      if (alunoErr) throw alunoErr;
      if (!aluno) return resp({ error: 'Aluno não encontrado.' }, 404);
      if (aluno.role !== 'aluno') return resp({ error: MSG_NAO_ALUNO }, 400);
      if (aluno.auth_id) {
        return resp({ error: 'Este aluno já possui acesso ao app. Use "Gerar nova senha".' }, 400);
      }

      const emailAluno = (aluno.email ?? '').trim().toLowerCase();
      if (!emailAluno) {
        return resp({ error: 'Cadastre um e-mail para o aluno antes de criar o acesso.' }, 400);
      }

      const senhaTemporaria = gerarSenhaTemporaria();
      const { data: criado, error: criarErr } = await admin.auth.admin.createUser({
        email: emailAluno,
        password: senhaTemporaria,
        email_confirm: true,
        user_metadata: { nome_completo: aluno.nome_completo },
      });
      if (criarErr) {
        if (criarErr.code === 'email_exists' || /already (been )?registered|already exists/i.test(criarErr.message)) {
          return resp({ error: 'Este e-mail já possui um acesso.' }, 400);
        }
        throw criarErr;
      }

      // Tudo ou nada: se o vínculo falhar (ou outro admin vinculou no meio
      // tempo), o login recém-criado é apagado em vez de ficar órfão.
      const { data: vinculado, error: vincErr } = await admin
        .from('alunos')
        .update({ auth_id: criado.user.id, primeiro_acesso: true, acesso_gerado_em: new Date().toISOString() })
        .eq('id', aluno.id)
        .is('auth_id', null)
        .select('id');
      if (vincErr || !vinculado?.length) {
        await admin.auth.admin.deleteUser(criado.user.id);
        if (vincErr) throw vincErr;
        return resp({ error: 'Este aluno acabou de receber acesso por outra ação. Recarregue a página.' }, 409);
      }

      // Senha só nesta resposta, para o admin repassar ao aluno.
      return resp({ email: emailAluno, senha_temporaria: senhaTemporaria });
    }

    // ── ILU-76/ILU-77: GERAR NOVA SENHA PROVISÓRIA ───────────────────────
    // A senha anterior deixa de valer e as sessões abertas são derrubadas
    // (trocar a senha sozinha não desconecta quem já está logado).
    if (acao === 'resetar_senha') {
      if (aluno_id == null) return resp({ error: 'aluno_id é obrigatório' }, 400);

      const { data: aluno, error: alunoErr } = await admin
        .from('alunos')
        .select('id, auth_id, role')
        .eq('id', aluno_id)
        .maybeSingle();
      if (alunoErr) throw alunoErr;
      if (!aluno) return resp({ error: 'Aluno não encontrado.' }, 404);
      if (aluno.role !== 'aluno') return resp({ error: MSG_NAO_ALUNO }, 400);
      if (!aluno.auth_id) {
        return resp({ error: 'Este aluno ainda não tem acesso ao app. Use "Criar acesso".' }, 400);
      }

      const senhaTemporaria = gerarSenhaTemporaria();
      const { data: atualizado, error: senhaErr } = await admin.auth.admin.updateUserById(aluno.auth_id, {
        password: senhaTemporaria,
      });
      if (senhaErr) throw senhaErr;

      const { error: sessoesErr } = await admin.rpc('revogar_sessoes_usuario', { p_user_id: aluno.auth_id });
      if (sessoesErr) {
        console.error('[criar_usuario] revogar sessões:', sessoesErr.message);
        return resp({
          error: 'A senha foi trocada, mas não foi possível desconectar as sessões abertas. Gere a senha novamente.',
        }, 500);
      }

      const { error: marcarErr } = await admin
        .from('alunos')
        .update({ primeiro_acesso: true, acesso_gerado_em: new Date().toISOString() })
        .eq('id', aluno.id);
      if (marcarErr) throw marcarErr;

      return resp({ email: atualizado.user.email, senha_temporaria: senhaTemporaria });
    }

    if (acao !== undefined) return resp({ error: `Ação desconhecida: ${acao}` }, 400);

    // ── LEGADO: { email, nome, role } — front anterior ao ILU-76 ─────────
    // Mantido só durante a transição (a função é publicada antes do front).
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
