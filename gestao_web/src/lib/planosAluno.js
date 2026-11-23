// Lógica pura dos planos do aluno (ILU-127, entrega 4): quais planos valem,
// situação de cada um e do aluno, rótulo, seletor, limite das modalidades por
// plano e avisos de vencimento. Sem supabase nem React; `hoje` é sempre
// parâmetro ('AAAA-MM-DD', de hojeBrasilia() nos chamadores).
import { formatarDiaMes } from './agendaAluno';

const LIMITE_LIVRE = 999;
const JANELA_VENCENDO = 7;
const JANELA_NOTIFICACAO = { de: -60, ate: 7 };

// Meio-dia UTC: a diferença nunca erra um dia por causa de fuso ou horário de verão.
const diferencaDias = (de, ate) =>
  Math.round((new Date(`${ate}T12:00:00Z`) - new Date(`${de}T12:00:00Z`)) / 86400000);

const instante = (v) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

const ordemPlano = (a, b) =>
  instante(a.created_at) - instante(b.created_at) ||
  String(a.id ?? '').localeCompare(String(b.id ?? ''));

const plural = (n) => (n === 1 ? 'dia' : 'dias');

// Mesma regra de _resolver_plano_aluno no banco.
const ehValido = (p, hoje) => !p.encerrado_em || p.encerrado_em >= hoje;

export function planosValidos(planos, hoje) {
  return (planos || []).filter((p) => ehValido(p, hoje)).sort(ordemPlano);
}

// `dias` é data_fim − hoje: negativo quando vencido. Plano encerrado e ainda
// válido segue o data_fim (conta até o fim); só o rótulo muda.
export function situacaoPlano(plano, hoje) {
  const encerrando = Boolean(plano.encerrado_em) && plano.encerrado_em >= hoje;
  let base;

  if (plano.pausado_desde) {
    base = { codigo: 'pausado', dias: null, rotulo: `Pausado desde ${formatarDiaMes(plano.pausado_desde)}`, tone: 'info' };
  } else if (!plano.data_fim) {
    base = { codigo: 'sem_data', dias: null, rotulo: 'Sem data', tone: 'neutral' };
  } else {
    const dias = diferencaDias(hoje, plano.data_fim);
    if (dias < 0) {
      base = { codigo: 'vencido', dias, rotulo: `Venceu há ${-dias} ${plural(-dias)}`, tone: 'destructive' };
    } else if (dias <= JANELA_VENCENDO) {
      base = {
        codigo: 'vencendo',
        dias,
        rotulo: dias === 0 ? 'Vence hoje' : `Vence em ${dias} ${plural(dias)}`,
        tone: 'warning',
      };
    } else {
      base = { codigo: 'em_dia', dias, rotulo: 'Em dia', tone: 'success' };
    }
  }

  if (encerrando && base.codigo !== 'vencido' && base.codigo !== 'pausado') {
    return { ...base, encerrando, rotulo: `Encerra em ${formatarDiaMes(plano.encerrado_em)}`, tone: 'neutral' };
  }
  return { ...base, encerrando };
}

const PIOR_PRIMEIRO = ['vencido', 'vencendo', 'em_dia', 'sem_data'];

// Pior situação entre os planos válidos; empate fica com o data_fim mais antigo.
// Pausado só quando todos os válidos estão pausados.
export function situacaoAluno(planos, hoje) {
  const validos = planosValidos(planos, hoje);
  if (validos.length === 0) return null;

  const comSituacao = validos.map((plano) => ({ plano, situacao: situacaoPlano(plano, hoje) }));
  const ativos = comSituacao.filter((x) => x.situacao.codigo !== 'pausado');
  const varios = validos.length > 1;
  if (ativos.length === 0) return { ...comSituacao[0], varios };

  const escolhido = ativos.reduce((melhor, atual) => {
    const dm = PIOR_PRIMEIRO.indexOf(melhor.situacao.codigo);
    const da = PIOR_PRIMEIRO.indexOf(atual.situacao.codigo);
    if (da !== dm) return da < dm ? atual : melhor;
    return (atual.plano.data_fim || '') < (melhor.plano.data_fim || '') ? atual : melhor;
  });
  return { ...escolhido, varios };
}

// Nome do plano; com outro plano do mesmo nome, ganha " (desde DD/MM/AA)".
export function rotuloPlanoAluno(plano, planosDoAluno) {
  const nome = plano.planos?.nome ?? '';
  const repetido = (planosDoAluno || []).filter((p) => p.planos?.nome === nome).length > 1;
  if (!repetido || !plano.data_inicio) return nome;
  const [ano, mes, dia] = plano.data_inicio.split('-');
  return `${nome} (desde ${dia}/${mes}/${ano.slice(-2)})`;
}

// A escolha atual, se ainda for válida; com um plano só, esse; senão, ninguém.
export function planoSugerido(planosValidosDoAluno, atual) {
  const lista = planosValidosDoAluno || [];
  if (atual && lista.some((p) => p.id === atual)) return atual;
  if (lista.length === 1) return lista[0].id;
  return null;
}

// Map<planoAlunoId, Map<área, vezes>> só com modalidades ligadas a um plano.
export function usoPorPlanoEArea(contagem, planoPorModalidade, areaPorModalidade) {
  const uso = new Map();
  Object.entries(contagem || {}).forEach(([modalidadeId, vezes]) => {
    const planoId = planoPorModalidade?.[modalidadeId];
    if (!planoId || !(vezes > 0)) return;
    const area = areaPorModalidade?.[modalidadeId];
    if (!uso.has(planoId)) uso.set(planoId, new Map());
    const porArea = uso.get(planoId);
    porArea.set(area, (porArea.get(area) || 0) + vezes);
  });
  return uso;
}

export function validarModalidades({ contagem, planoPorModalidade, planos, areaPorModalidade }) {
  const lista = planos || [];
  const planoPorId = new Map(lista.map((p) => [p.id, p]));

  const faltaPlano = Object.entries(contagem || {}).some(
    ([modalidadeId, vezes]) => vezes > 0 && !planoPorId.has(planoPorModalidade?.[modalidadeId])
  );
  if (faltaPlano) return 'Escolha o plano de cada modalidade.';

  const uso = usoPorPlanoEArea(contagem, planoPorModalidade, areaPorModalidade);
  for (const [planoId, porArea] of uso) {
    const plano = planoPorId.get(planoId);
    const regras = plano.planos?.regras_acesso || [];
    for (const [area, usado] of porArea) {
      const regra = regras.find((r) => r.modalidade === area);
      const rotulo = rotuloPlanoAluno(plano, lista);
      if (!regra) return `O plano ${rotulo} não inclui ${area}.`;
      if (regra.limite !== LIMITE_LIVRE && usado > regra.limite) {
        return `O plano ${rotulo} permite ${regra.limite}x em ${area}.`;
      }
    }
  }
  return null;
}

export function montarItensModalidades(contagem, planoPorModalidade) {
  return Object.entries(contagem || {})
    .filter(([, vezes]) => vezes > 0)
    .map(([modalidadeId, vezes]) => ({
      modalidade_id: modalidadeId,
      vezes,
      plano_aluno_id: planoPorModalidade?.[modalidadeId],
    }));
}

// `linhas`: planos_aluno com alunos(...) e planos(...) aninhados. Um aluno com
// um plano válido mantém o id antigo; com vários, o id leva o plano.
export function notificacoesDeVencimento(linhas, hoje) {
  const validas = (linhas || []).filter((l) => ehValido(l, hoje));
  const porAluno = new Map();
  validas.forEach((l) => {
    const id = l.alunos?.id;
    if (!porAluno.has(id)) porAluno.set(id, []);
    porAluno.get(id).push(l);
  });

  return validas
    .filter((l) => l.alunos && l.alunos.ativo !== false && !l.pausado_desde && l.data_fim)
    .map((l) => {
      const doAluno = porAluno.get(l.alunos.id);
      const varios = doAluno.length > 1;
      return {
        idUnico: varios
          ? `venc-${l.alunos.id}-${l.id}-${l.data_fim}`
          : `venc-${l.alunos.id}-${l.data_fim}`,
        tipo: 'vencimento',
        aluno: { ...l.alunos, planos: { nome: rotuloPlanoAluno(l, doAluno) } },
        dataAlvo: l.data_fim,
        diasFaltando: diferencaDias(hoje, l.data_fim),
      };
    })
    .filter((n) => n.diasFaltando >= JANELA_NOTIFICACAO.de && n.diasFaltando <= JANELA_NOTIFICACAO.ate);
}
