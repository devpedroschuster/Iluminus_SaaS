import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query'; // 🌟 Importante para atualizar a UI
import { gradeService } from '../../../services/gradeService';
import { showToast } from '../../../components/shared/Toast';

export function useGradeMutations({ onSuccess }) {
  const [savingAula, setSavingAula] = useState(false);
  const queryClient = useQueryClient();

  // Função auxiliar para limpar o cache da agenda
  const invalidarCacheAgenda = () => {
    queryClient.invalidateQueries({ queryKey: ['agenda'] });
    queryClient.invalidateQueries({ queryKey: ['feriados'] });
    // Invalida também as presenças para garantir que a lotação no card se mantém correta
    queryClient.invalidateQueries({ queryKey: ['presencas-calendario'] });
  };

  const salvarAula = async (novaAula) => {
    setSavingAula(true);
    try {
      const payload = {
        atividade: novaAula.atividade || novaAula.nomeModalidade || '',
        modalidade_id: novaAula.modalidadeId || null,
        professor_id: novaAula.professorId || null,
        horario: novaAula.horario,
        capacidade: Number(novaAula.capacidade) || 15,
        eh_recorrente: novaAula.ehRecorrente,
        data_especifica: novaAula.dataEspecifica || null,
        espaco: novaAula.espaco,
        valor_por_aluno: Number(novaAula.valorPorAluno) || 0,
        cor: novaAula.cor || 'laranja',
        ativa: true
      };

      if (novaAula.id) {
        payload.id = novaAula.id;
      }

      if (novaAula.ehRecorrente) {
        payload.dia_semana = novaAula.diaSemana.toLowerCase();
        if (!payload.modalidade_id) throw new Error("Selecione uma Modalidade.");
      } else {
        if (!novaAula.dataEspecifica) throw new Error("Data é obrigatória.");
        // 🌟 Correção de Timezone: Forçar meio-dia para evitar que o dia mude no Parse
        const diaCalculado = format(new Date(novaAula.dataEspecifica + 'T12:00:00'), 'eeee', { locale: ptBR });
        payload.dia_semana = diaCalculado.toLowerCase();
      }

      await gradeService.salvarAula(payload);
      
      invalidarCacheAgenda();
      showToast.success("Grade atualizada com sucesso!");
      onSuccess?.();
    } catch (err) { 
      showToast.error(err.message); 
    } finally { 
      setSavingAula(false); 
    }
  };

  const excluirAula = async (eventoId) => {
    try {
      await gradeService.excluirAula(eventoId);
      invalidarCacheAgenda();
      showToast.success("Grade removida com sucesso.");
      onSuccess?.();
    } catch (err) {
      showToast.error(err.message || "Erro ao excluir.");
    }
  };

  /**
   * Retorna { dataClicada, dataFormatada } para que o caller possa exibir
   * a data em pt-BR no modal de confirmação antes de chamar confirmarEncerramento.
   */
  const prepararEncerramento = (dataStart) => {
    const dataClicada = format(dataStart, 'yyyy-MM-dd');
    const dataFormatada = format(dataStart, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    return { dataClicada, dataFormatada };
  };

  const encerrarAula = async (eventoId, dataStart) => {
    try {
      // Usamos a data clicada para definir quando a recorrência para
      const { dataClicada } = prepararEncerramento(dataStart);
      await gradeService.encerrarAula(eventoId, dataClicada);

      invalidarCacheAgenda();
      showToast.success("Turma encerrada a partir desta data.");
      onSuccess?.();
    } catch (err) {
      showToast.error(err.message || "Erro ao encerrar turma.");
    }
  };

  return {
    salvarAula,
    excluirAula,
    encerrarAula,
    prepararEncerramento,
    savingAula
  };
}