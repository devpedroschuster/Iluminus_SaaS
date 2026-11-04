import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { startOfDay } from 'date-fns';
import { hojeBrasilia } from '../lib/utils';
import { notificacoesDePausa } from '../lib/pausaPlano';

export function useNotificacoes() {
  const [resolvidas, setResolvidas] = useState(() => {
    const salvas = localStorage.getItem('iluminus_notificacoes_resolvidas');
    return salvas ? JSON.parse(salvas) : [];
  });

  const marcarComoResolvida = (idUnico) => {
    setResolvidas(prev => {
      const novas = [...prev, idUnico];
      localStorage.setItem('iluminus_notificacoes_resolvidas', JSON.stringify(novas));
      return novas;
    });
  };

  const desfazerResolvida = (idUnico) => {
    setResolvidas(prev => {
      const novas = prev.filter(id => id !== idUnico);
      localStorage.setItem('iluminus_notificacoes_resolvidas', JSON.stringify(novas));
      return novas;
    });
  };

  const query = useQuery({
    queryKey: ['notificacoes-gerais'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alunos')
        .select('id, nome_completo, telefone, data_nascimento, data_fim_plano, plano_pausado_desde, planos(nome)')
        .eq('ativo', true);

      if (error) throw error;

      // ILU-114: a previsão de volta de uma pausa é só um lembrete; quando chega,
      // a gestão precisa retomar o plano ou ajustar a data.
      const { data: pausasAbertas, error: errPausas } = await supabase
        .from('pausas_plano')
        .select('data_prevista_volta, alunos(id, nome_completo, ativo)')
        .is('data_retorno', null);

      if (errPausas) throw errPausas;

      const hoje = startOfDay(new Date());
      const anoAtual = hoje.getFullYear();
      const notificacoes = notificacoesDePausa(pausasAbertas, hojeBrasilia());

      data.forEach(aluno => {
        // ILU-114: o vencimento fica parado durante a pausa.
        if (aluno.data_fim_plano && !aluno.plano_pausado_desde) {
          const dataFim = startOfDay(new Date(aluno.data_fim_plano + 'T12:00:00'));
          const diasFaltando = Math.ceil((dataFim - hoje) / (1000 * 60 * 60 * 24));
          
          if (diasFaltando <= 7 && diasFaltando >= -60) {
            notificacoes.push({
              idUnico: `venc-${aluno.id}-${aluno.data_fim_plano}`,
              tipo: 'vencimento',
              aluno,
              dataAlvo: aluno.data_fim_plano,
              diasFaltando
            });
          }
        }

        if (aluno.data_nascimento) {
          const [, mesNasc, diaNasc] = aluno.data_nascimento.split('-');
          let niverEsteAno = startOfDay(new Date(anoAtual, mesNasc - 1, diaNasc));
          let diasFaltandoNiver = Math.ceil((niverEsteAno - hoje) / (1000 * 60 * 60 * 24));

          if (diasFaltandoNiver < -20) {
             niverEsteAno = startOfDay(new Date(anoAtual + 1, mesNasc - 1, diaNasc));
             diasFaltandoNiver = Math.ceil((niverEsteAno - hoje) / (1000 * 60 * 60 * 24));
          }

          if (diasFaltandoNiver <= 7) {
            notificacoes.push({
              idUnico: `niver-${aluno.id}-${niverEsteAno.getFullYear()}`,
              tipo: 'aniversario',
              aluno,
              dataAlvo: niverEsteAno.toISOString().split('T')[0],
              diasFaltando: diasFaltandoNiver
            });
          }
        }
      });

      return notificacoes.sort((a, b) => a.diasFaltando - b.diasFaltando);
    }
  });

  const todasAsNotificacoes = query.data || [];
  const ativas = todasAsNotificacoes.filter(n => !resolvidas.includes(n.idUnico));
  const concluidas = todasAsNotificacoes.filter(n => resolvidas.includes(n.idUnico));

  return {
    ativas,
    concluidas,
    loading: query.isLoading,
    // ILU-42: expõe erro da query em vez de deixar a página tratar falha
    // como "nenhuma notificação" (data undefined -> [] -> lista vazia).
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    marcarComoResolvida,
    desfazerResolvida,
  };
}