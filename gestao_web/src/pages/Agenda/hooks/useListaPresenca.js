import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { agendamentoService } from '../../../services/agendamentoService';
import { showToast } from '../../../components/shared/Toast';

export function useListaPresenca(aulaParaLista, dataLista, isOpen, onAtualizar) {
  const [listaPresenca, setListaPresenca] = useState([]);
  const queryClient = useQueryClient();
  const [loadingLista, setLoadingLista] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);
  const [alunoParaRemover, setAlunoParaRemover] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    async function buscarLista() {
      if (isOpen && aulaParaLista && dataLista) {
        setLoadingLista(true);
        try {
          const presencas = await agendamentoService.listarChamadaCompleta(aulaParaLista.id, dataLista);
          setListaPresenca(presencas || []);
        } finally {
          setLoadingLista(false);
        }
      }
    }
    buscarLista();
  }, [isOpen, aulaParaLista, dataLista, refreshKey]);

  const solicitarRemocao = (idRelacao) => setAlunoParaRemover(idRelacao);
  const cancelarRemocao = () => setAlunoParaRemover(null);

  const confirmarRemocao = async () => {
    if (!alunoParaRemover) return;
    setRemovendoId(alunoParaRemover);
    try {
      await agendamentoService.cancelarAgendamento(alunoParaRemover);
      showToast.success("Aluno removido da lista!");
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao remover: " + err.message);
    } finally {
      setRemovendoId(null);
      setAlunoParaRemover(null);
    }
  };

  const handleRegistrarFalta = async (aluno) => {
    try {
      await agendamentoService.registrarFalta(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta informada. Aluno removido do card.");
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao registrar falta.");
    }
  };

  const handleDesfazerFalta = async (aluno) => {
    try {
      await agendamentoService.removerFalta(aluno.aluno_id, aulaParaLista.id, dataLista);
      showToast.success("Falta removida.");
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao remover falta.");
    }
  };

  return { 
    listaPresenca, loadingLista, removendoId, 
    handleRegistrarFalta, handleDesfazerFalta,
    alunoParaRemover, solicitarRemocao, confirmarRemocao, cancelarRemocao, refreshKey
  };
}