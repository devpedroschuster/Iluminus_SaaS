// supabase/functions/preview-repasses-mensais/index.ts
//
// DRY-RUN da geração de repasses mensais (ILU-122).
// Chama `rpc('apurar_repasses', { p_competencia, p_simular: true })`: o banco
// apura exatamente como na geração real, mas NÃO grava nada. Retorna um resumo
// por professor que o frontend exibe no modal de confirmação.
//
// Body: { mes: number (1–12), ano: number }
//
// Response (200):
// {
//   jaGerados: boolean,          // true → alguma comissão do mês já existia (informativo)
//   mes: 'MM/AAAA',
//   totalGeral: number,          // soma das comissões que seriam geradas
//   professores: [               // ordenado por total desc
//     { professor_id, nome, total, qtdLancamentos, breakdown: { regular, plano_livre } }
//   ],
//   avisos: string[],            // alunos/modalidades sem comissão, com motivo
//   lancamentosPrevistos: number // total de linhas que seriam inseridas
//   config: { valor_1_modalidade, valor_multi_modalidade, plano_livre_pct_prof }
// }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { avisoDaLinha, resumirPorProfessor, type LinhaApuracao } from '../_shared/repasses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── AUTORIZAÇÃO (ILU-10) ─────────────────────────────────────────────────
    // Embora não escreva dados, este preview expõe o valor exato de comissão
    // projetada de CADA professor para qualquer mês — vazamento de
    // remuneração de terceiros para qualquer aluno/professor autenticado.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return response({ error: 'Não autenticado: token ausente' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return response({ error: 'Não autenticado: token inválido' }, 401);
    }

    const { data: solicitante, error: perfilErr } = await supabase
      .from('alunos')
      .select('role')
      .eq('auth_id', userData.user.id)
      .maybeSingle();

    if (perfilErr) {
      console.error('[preview-repasses-mensais] erro ao checar perfil:', perfilErr.message);
      return response({ error: 'Erro ao validar permissões' }, 500);
    }

    if (solicitante?.role !== 'admin') {
      return response({ error: 'Acesso negado: apenas administradores podem executar esta ação' }, 403);
    }

    const { mes, ano } = await req.json();

    if (!mes || !ano || mes < 1 || mes > 12) {
      return response({ error: 'Parâmetros inválidos. Informe mes (1–12) e ano.' }, 400);
    }

    const mesStr = String(mes).padStart(2, '0');
    const dataReferencia = `${ano}-${mesStr}-01`;

    // ── 1. Apuração simulada no banco (não grava) ───────────────────────────
    const { data: linhasRpc, error: errRpc } = await supabase.rpc('apurar_repasses', {
      p_competencia: dataReferencia,
      p_simular: true,
    });
    if (errRpc) {
      return response({ error: errRpc.message }, 500);
    }

    const linhas = (linhasRpc ?? []) as LinhaApuracao[];
    const loteJaGeradoAntes = linhas.some((l) => l.situacao === 'ja_existia');
    const avisos: string[] = linhas
      .map(avisoDaLinha)
      .filter((a): a is string => a !== null);

    // ── 2. Nomes dos professores ────────────────────────────────────────────
    const { data: profsRaw, error: errProfs } = await supabase
      .from('professores')
      .select('id, nome');
    if (errProfs) throw errProfs;

    const nomes = new Map<string, string>();
    for (const p of (profsRaw ?? []) as { id: string; nome: string }[]) nomes.set(p.id, p.nome);

    // ── 3. Configurações exibidas no rodapé do modal ────────────────────────
    const { data: config, error: errConfig } = await supabase
      .from('configuracoes_repasse')
      .select('valor_1_modalidade, valor_multi_modalidade, plano_livre_pct_prof')
      .single();

    if (errConfig || !config) throw new Error('Configurações de repasse não encontradas.');

    // ── 4. Resumo por professor ─────────────────────────────────────────────
    const professores = resumirPorProfessor(linhas, nomes);
    const totalGeral = professores.reduce((soma, p) => soma + p.total, 0);
    const lancamentosPrevistos = professores.reduce((soma, p) => soma + p.qtdLancamentos, 0);

    return response({
      jaGerados: loteJaGeradoAntes,
      mes: `${mesStr}/${ano}`,
      totalGeral: Math.round(totalGeral * 100) / 100,
      professores,
      avisos,
      lancamentosPrevistos,
      config: {
        valor_1_modalidade: config.valor_1_modalidade,
        valor_multi_modalidade: config.valor_multi_modalidade,
        plano_livre_pct_prof: config.plano_livre_pct_prof,
      },
    });

  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err);
    console.error('[preview-repasses-mensais] ERRO:', message);
    return response({ error: message }, 500);
  }
});