import { useState, useEffect } from 'react';
import { agendaService } from '../../../services/agendaService';
import { showToast } from '../../../components/shared/Toast';

export function useListaPresenca(aulaParaLista, dataLista, isOpen, onAtualizar) {
  const [listaPresenca, setListaPresenca] = useState([]);
  const [loadingLista, setLoadingLista] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);

  useEffect(() => {
    async function buscarLista() {
      if (isOpen && aulaParaLista && dataLista) {
        setLoadingLista(true);
        try {
          const presencas = await agendaService.listarChamadaCompleta(aulaParaLista.id, dataLista);
          setListaPresenca(presencas || []);
        } finally {
          setLoadingLista(false);
        }
      }
    }
    buscarLista();
  }, [isOpen, aulaParaLista, dataLista, onAtualizar]);

  const handleRemoverPresenca = async (idRelacao) => {
    if (!window.confirm(`Tem certeza que deseja remover este aluno?`)) return;
    setRemovendoId(idRelacao);
    try {
      await agendaService.cancelarAgendamento(idRelacao);
      showToast.success("Aluno removido da lista!");
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao remover: " + err.message);
    } finally {
      setRemovendoId(null);
    }
  };

  const handleRegistrarFalta = async (aluno) => {
    try {
      await agendaService.registrarFalta(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta informada. Aluno removido do card.");
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao registrar falta.");
    }
  };

  const handleDesfazerFalta = async (aluno) => {
    try {
      await agendaService.removerFalta(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta removida.");
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao remover falta.");
    }
  };

  return { listaPresenca, loadingLista, removendoId, handleRemoverPresenca, handleRegistrarFalta, handleDesfazerFalta };
}