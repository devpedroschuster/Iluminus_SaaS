import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { agendamentoService } from '../../../services/agendamentoService';
import { showToast } from '../../../components/shared/Toast';

export function useAgendamento(onSucesso, feriados = []) {
  const queryClient = useQueryClient();
  const [agendamentoForm, setAgendamentoForm] = useState({ tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: '', data_aula: '' });
  const [savingAgendamento, setSavingAgendamento] = useState(false);
  const [infoVaga, setInfoVaga] = useState(null);
  const [verificandoVaga, setVerificandoVaga] = useState(false);

  useEffect(() => {
    async function checarDisponibilidadeLive() {
      if (agendamentoForm.aula_id && agendamentoForm.data_aula) {
        setVerificandoVaga(true);
        const alunoIdParaChecar = agendamentoForm.tipo === 'cadastrado' ? agendamentoForm.aluno_id : null;
        const info = await agendamentoService.verificarDisponibilidade(agendamentoForm.aula_id, agendamentoForm.data_aula, alunoIdParaChecar);
        setInfoVaga(info);
        setVerificandoVaga(false);
      } else {
        setInfoVaga(null);
      }
    }
    checarDisponibilidadeLive();
  }, [agendamentoForm.aula_id, agendamentoForm.data_aula, agendamentoForm.aluno_id, agendamentoForm.tipo]);

  const handleAgendarAluno = async (e, ignorarAvisos = false) => {
    if (e) e.preventDefault();
    
    if (agendamentoForm.data_aula) {
      const ehFeriado = feriados.find(f => f.data === agendamentoForm.data_aula && f.bloqueia_agenda);
      if (ehFeriado) {
        showToast.error(`Agenda Bloqueada: Não é possível agendar no feriado de ${ehFeriado.descricao}.`);
        return false;
      }
    }

    if (savingAgendamento) return;
    setSavingAgendamento(true);
    
    try {
      await agendamentoService.agendarAulaAdmin({ ...agendamentoForm, ignorarAvisos });
      showToast.success("Agendamento realizado com sucesso!");
      setAgendamentoForm({ tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: '', data_aula: '' });
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      if (onSucesso) onSucesso();
      return true; 
    } catch (err) {
      const msgErro = err.message || "";
      if (msgErro.includes("lotada") || msgErro.includes("limite do plano")) {
         if (window.confirm(`⚠️ AVISO DO SISTEMA:\n\n${msgErro}`)) {
            setSavingAgendamento(false);
            return handleAgendarAluno(null, true); 
         }
      } else {
         showToast.error("Erro ao agendar: " + msgErro);
      }
      return false; 
    } finally {
      setSavingAgendamento(false);
    }
  };

  return { agendamentoForm, setAgendamentoForm, handleAgendarAluno, savingAgendamento, infoVaga, verificandoVaga };
}