import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { agendamentoService } from '../../../services/agendamentoService';
import { showToast } from '../../../components/shared/Toast';

export function useListaPresenca(aulaParaLista, dataLista, isOpen, onAtualizar) {
  const [listaPresenca, setListaPresenca] = useState([]);
  const queryClient = useQueryClient();
  const [loadingLista, setLoadingLista] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);
  const [marcandoId, setMarcandoId] = useState(null); // id_relacao (ou aluno_id p/ fixo sem linha) em processamento
  const [alunoParaRemover, setAlunoParaRemover] = useState(null); // { idRelacao, tipo }
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

  const solicitarRemocao = (idRelacao, tipo) => setAlunoParaRemover({ idRelacao, tipo });
  const cancelarRemocao = () => setAlunoParaRemover(null);

  const confirmarRemocao = async () => {
    if (!alunoParaRemover) return;
    setRemovendoId(alunoParaRemover.idRelacao);
    try {
      const tipoService = alunoParaRemover.tipo === 'experimental' ? 'lead' : 'presenca';
      await agendamentoService.cancelarAgendamento(alunoParaRemover.idRelacao, tipoService);
      showToast.success("Removido da lista!");
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

  // Marcar/desmarcar presença: admin pode fazer isso a qualquer horário,
  // direto pelo modal de chamada na Agenda (não fica preso à janela de
  // ±30min que existe na Chamada Rápida).
  const handleMarcarPresenca = async (aluno, reposicaoDeId = null) => {
    const chaveLoading = aluno.id_relacao || aluno.aluno_id;
    setMarcandoId(chaveLoading);
    try {
      await agendamentoService.marcarPresenca({
        alunoId: aluno.aluno_id,
        aulaId: aulaParaLista.id,
        dataAula: dataLista,
        idRelacao: aluno.id_relacao,
        tipo: aluno.tipo,
        reposicaoDeId,
      });
      showToast.success("Presença confirmada!");
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao marcar presença: " + err.message);
    } finally {
      setMarcandoId(null);
    }
  };

  const handleDesmarcarPresenca = async (aluno) => {
    setMarcandoId(aluno.id_relacao);
    try {
      await agendamentoService.desmarcarPresenca({ idRelacao: aluno.id_relacao, tipo: aluno.tipo });
      showToast.success("Presença desmarcada.");
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error("Erro ao desmarcar presença: " + err.message);
    } finally {
      setMarcandoId(null);
    }
  };

  return { 
    listaPresenca, loadingLista, removendoId, marcandoId,
    handleRegistrarFalta, handleDesfazerFalta,
    handleMarcarPresenca, handleDesmarcarPresenca,
    alunoParaRemover, solicitarRemocao, confirmarRemocao, cancelarRemocao, refreshKey
  };
}