// supabase/functions/_shared/repasses.ts
//
// Funções PURAS (sem import de Supabase) compartilhadas pelas Edge Functions de
// repasse, que agora delegam o cálculo às RPCs `apurar_repasses` e
// `apurar_repasses_da_cobranca` (ILU-122). Mantido sem dependências de rede para
// que `deno test` rode offline.

export type SituacaoApuracao =
  | 'gerada'
  | 'ja_existia'
  | 'removida_pela_gestao'
  | 'sem_cobertura'
  | 'bolsista'
  | 'pausado'
  | 'inativo'
  | 'sem_professor'
  | 'plano_livre_sem_presenca'
  | 'plano_livre_mes_em_andamento';

// Linha do RETURNS TABLE das RPCs. `valor` é numeric no Postgres: o PostgREST
// o serializa como STRING — sempre converter com Number().
export type LinhaApuracao = {
  aluno_id: number;
  aluno_nome: string;
  modalidade_id: string | null;
  modalidade: string | null;
  professor_id: string | null;
  tipo_aula: string | null;
  competencia: string | null;
  data_referencia: string | null;
  valor: string | number | null;
  mensalidade_id: number | null;
  situacao: SituacaoApuracao | string;
};

export const ROTULOS_SITUACAO: Record<string, string> = {
  sem_cobertura: 'Mês não pago',
  bolsista: 'Bolsista',
  pausado: 'Plano pausado no mês',
  inativo: 'Aluno inativo',
  sem_professor: 'Modalidade sem professor',
  plano_livre_sem_presenca: 'Plano livre sem presença no mês',
  plano_livre_mes_em_andamento: 'Plano livre: entra quando o mês terminar',
  removida_pela_gestao: 'Comissão removida pela gestão',
};

export function avisoDaLinha(l: LinhaApuracao): string | null {
  const rotulo = ROTULOS_SITUACAO[l.situacao];
  if (!rotulo) return null; // gerada / ja_existia (ou situação desconhecida)
  return l.modalidade
    ? `${l.aluno_nome} (${l.modalidade}): ${rotulo}`
    : `${l.aluno_nome}: ${rotulo}`;
}

export type ResumoProfessor = {
  professor_id: string;
  nome: string;
  total: number;
  qtdLancamentos: number;
  breakdown: { regular: number; plano_livre: number };
};

const arred = (n: number) => Math.round(n * 100) / 100;

// Agrega só as linhas `gerada`, por professor, ordenado por total decrescente.
export function resumirPorProfessor(
  linhas: LinhaApuracao[],
  nomes: Map<string, string>,
): ResumoProfessor[] {
  const mapa = new Map<string, ResumoProfessor>();
  for (const l of linhas) {
    if (l.situacao !== 'gerada' || !l.professor_id) continue;
    const valor = Number(l.valor);
    let r = mapa.get(l.professor_id);
    if (!r) {
      r = {
        professor_id: l.professor_id,
        nome: nomes.get(l.professor_id) ?? 'Professor',
        total: 0,
        qtdLancamentos: 0,
        breakdown: { regular: 0, plano_livre: 0 },
      };
      mapa.set(l.professor_id, r);
    }
    r.total = arred(r.total + valor);
    r.qtdLancamentos += 1;
    if (l.tipo_aula === 'regular' || l.tipo_aula === 'plano_livre') {
      r.breakdown[l.tipo_aula] = arred(r.breakdown[l.tipo_aula] + valor);
    }
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}
