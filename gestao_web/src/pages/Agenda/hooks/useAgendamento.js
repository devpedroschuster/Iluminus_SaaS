import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { agendamentoService } from '../../../services/agendamentoService';
import { showToast } from '../../../components/shared/Toast';

// Classifica o motivo do bloqueio a partir da mensagem de erro do service/RPC.
// Retorna 'lotacao' | 'plano' | null
function classificarMotivoAviso(msgErro) {
  if (!msgErro) return null;
  if (msgErro.includes('lotada') || msgErro.includes('atingiu o limite')) {
    return 'lotacao';
  }
  // Mensagens que indicam restrição de plano: limite semanal esgotado ou
  // modalidade fora do plano do aluno (vindas do RPC via avisoCritico).
  if (
    msgErro.includes('limite semanal') ||
    msgErro.includes('fora do plano') ||
    msgErro.includes('não está no plano') ||
    msgErro.includes('plano do aluno') ||
    msgErro.includes('modalidade') ||
    msgErro.includes('plano')
  ) {
    return 'plano';
  }
  return null;
}

export function useAgendamento(onSucesso, feriados = []) {
  const queryClient = useQueryClient();

  const [agendamentoForm, setAgendamentoForm] = useState({
    tipo: 'cadastrado',
    aluno_id: '',
    nome_visitante: '',
    aula_id: '',
    data_aula: '',
    // Campos de exibição — preenchidos pelo modal ao selecionar aluno/aula.
    // Não são enviados ao banco; apenas enriquecem o toast de sucesso.
    _nomeAluno: '',
    _nomeAtividade: '',
  });

  const [savingAgendamento, setSavingAgendamento] = useState(false);
  const [infoVaga, setInfoVaga] = useState(null);
  const [verificandoVaga, setVerificandoVaga] = useState(false);

  // Estado unificado para qualquer modal de aviso que permite prosseguir.
  // tipo: 'lotacao' | 'plano' | ''
  const [modalLotacao, setModalLotacao] = useState({ isOpen: false, msg: '', tipo: '' });

  useEffect(() => {
    async function checarDisponibilidadeLive() {
      if (agendamentoForm.aula_id && agendamentoForm.data_aula) {
        setVerificandoVaga(true);
        const alunoIdParaChecar =
          agendamentoForm.tipo === 'cadastrado' ? agendamentoForm.aluno_id : null;
        const info = await agendamentoService.verificarDisponibilidade(
          agendamentoForm.aula_id,
          agendamentoForm.data_aula,
          alunoIdParaChecar
        );
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
      const ehFeriado = feriados.find(
        f => f.data === agendamentoForm.data_aula && f.bloqueia_agenda
      );
      if (ehFeriado) {
        showToast.error(`Agenda bloqueada: ${ehFeriado.descricao} é feriado. Escolha outra data.`);
        return false;
      }
    }

    if (savingAgendamento) return;
    setSavingAgendamento(true);

    try {
      await agendamentoService.agendarAulaAdmin({ ...agendamentoForm, ignorarAvisos });

      // ── Toast contextual ───────────────────────────────────────────────
      const nome =
        agendamentoForm.tipo === 'visitante'
          ? agendamentoForm.nome_visitante || 'Visitante'
          : agendamentoForm._nomeAluno || 'Aluno';

      const atividade = agendamentoForm._nomeAtividade || 'aula';

      const dataFormatada = agendamentoForm.data_aula
        ? format(new Date(agendamentoForm.data_aula + 'T12:00:00'), "dd/MM", { locale: ptBR })
        : '';

      const msgSucesso = dataFormatada
        ? `✅ ${nome} agendado para ${atividade} em ${dataFormatada}. Tudo certo!`
        : `✅ ${nome} agendado para ${atividade}. Tudo certo!`;

      showToast.success(msgSucesso);
      // ──────────────────────────────────────────────────────────────────

      setAgendamentoForm({
        tipo: 'cadastrado',
        aluno_id: '',
        nome_visitante: '',
        aula_id: '',
        data_aula: '',
        _nomeAluno: '',
        _nomeAtividade: '',
      });

      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      if (onSucesso) onSucesso();
      return true;
    } catch (err) {
      const msgErro = err.message || '';
      const motivo = classificarMotivoAviso(msgErro);

      if (motivo === 'lotacao' || motivo === 'plano') {
        // Abre o modal de confirmação com contexto adequado.
        setModalLotacao({ isOpen: true, msg: msgErro, tipo: motivo });
        setSavingAgendamento(false);
        return false;
      } else if (msgErro.includes('já possui um agendamento')) {
        showToast.error('Este aluno já está agendado nesta turma nessa data.');
      } else {
        showToast.error('Não foi possível realizar o agendamento. Tente novamente.');
      }
      return false;
    } finally {
      if (!modalLotacao.isOpen) setSavingAgendamento(false);
    }
  };

  const confirmarAgendamentoLotado = () => {
    setModalLotacao({ isOpen: false, msg: '', tipo: '' });
    handleAgendarAluno(null, true);
  };

  const cancelarAgendamentoLotado = () => {
    setModalLotacao({ isOpen: false, msg: '', tipo: '' });
    setSavingAgendamento(false);
  };

  return {
    agendamentoForm, setAgendamentoForm, handleAgendarAluno,
    savingAgendamento, infoVaga, verificandoVaga,
    modalLotacao, confirmarAgendamentoLotado, cancelarAgendamentoLotado,
  };
}