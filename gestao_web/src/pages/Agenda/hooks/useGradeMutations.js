import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { gradeService } from '../../../services/gradeService';
import { showToast } from '../../../components/shared/Toast';

export function useGradeMutations({ onSuccess }) {
  const [savingAula, setSavingAula] = useState(false);

  const salvarAula = async (novaAula) => {
    setSavingAula(true);
    try {
      const payload = {
        ...novaAula,
        capacidade: Number(novaAula.capacidade) || 15,
        valor_por_aluno: Number(novaAula.valor_por_aluno) || 0,
        cor: novaAula.cor || 'laranja',
        ativa: true
      };

      if (novaAula.eh_recorrente) {
        payload.data_especifica = null;
        if (!payload.modalidade_id) throw new Error("Selecione uma Modalidade para aulas recorrentes.");
      } else {
        if (!novaAula.data_especifica) throw new Error("Data é obrigatória para evento único.");
        const diaCalculado = format(new Date(novaAula.data_especifica + 'T12:00:00'), 'eeee', { locale: ptBR });
        payload.dia_semana = diaCalculado.charAt(0).toUpperCase() + diaCalculado.slice(1);
      }

      await gradeService.salvarAula(payload);
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
      showToast.success("Grade removida com sucesso.");
      onSuccess?.();
    } catch (err) { 
      showToast.error("Erro ao excluir."); 
    }
  };

  const encerrarAula = async (eventoId, dataStart) => {
    try {
      const dataClicada = format(dataStart, 'yyyy-MM-dd');
      await gradeService.encerrarAula(eventoId, dataClicada);
      showToast.success("Turma encerrada desta data em diante. O histórico foi mantido!");
      onSuccess?.();
    } catch (err) { 
      showToast.error("Erro ao encerrar a turma."); 
    }
  };

  return { savingAula, salvarAula, excluirAula, encerrarAula };
}