import { useState, useEffect } from 'react';
import { agendamentoService } from '../../../services/agendaService';
import { showToast } from '../../../components/shared/Toast';

export function useAgendamento(onSucesso) {
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
    if (savingAgendamento) return;
    setSavingAgendamento(true);
    
    try {
      await agendamentoService.agendarAulaAdmin({ ...agendamentoForm, ignorarAvisos });
      showToast.success("Agendamento realizado com sucesso!");
      setAgendamentoForm({ tipo: 'cadastrado', aluno_id: '', nome_visitante: '', aula_id: '', data_aula: '' });
      if (onSucesso) onSucesso();
      return true; // Sucesso
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
      return false; // Falha ou cancelado
    } finally {
      setSavingAgendamento(false);
    }
  };

  return { agendamentoForm, setAgendamentoForm, handleAgendarAluno, savingAgendamento, infoVaga, verificandoVaga };
}