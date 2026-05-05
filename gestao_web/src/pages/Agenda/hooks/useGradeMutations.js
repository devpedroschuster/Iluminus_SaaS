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
        atividade: novaAula.atividade,
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

      // 3. Regras de datas
      if (novaAula.ehRecorrente) {
        payload.dia_semana = novaAula.diaSemana.toLowerCase();
        if (!payload.modalidade_id) throw new Error("Selecione uma Modalidade.");
      } else {
        if (!novaAula.dataEspecifica) throw new Error("Data é obrigatória.");
        const diaCalculado = format(new Date(novaAula.dataEspecifica + 'T12:00:00'), 'eeee', { locale: ptBR });
        payload.dia_semana = diaCalculado.toLowerCase();
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