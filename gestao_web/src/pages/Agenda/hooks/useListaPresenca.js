import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { agendamentoService } from '../../../services/agendamentoService';
import { showToast } from '../../../components/shared/showToast';

export function useListaPresenca(aulaParaLista, dataLista, isOpen, onAtualizar) {
  const [listaPresenca, setListaPresenca] = useState([]);
  const queryClient = useQueryClient();
  const [loadingLista, setLoadingLista] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);
  const [marcandoId, setMarcandoId] = useState(null); // id_relacao (ou aluno_id p/ fixo sem linha) em processamento
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(null); // qual botão dessa linha foi tocado (ILU-95)
  const [alunoParaRemover, setAlunoParaRemover] = useState(null); // { idRelacao, tipo }
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // ILU-46: ignora resposta obsoleta se data/aula mudarem antes de resolver
    // — sem isso, uma request lenta podia sobrescrever a lista com a turma/
    // data errada, e o admin marcaria presença/falta na turma errada.
    let cancelado = false;
    async function buscarLista() {
      if (isOpen && aulaParaLista && dataLista) {
        setLoadingLista(true);
        try {
          const presencas = await agendamentoService.listarChamadaCompleta(aulaParaLista.id, dataLista);
          if (!cancelado) setListaPresenca(presencas || []);
        } finally {
          if (!cancelado) setLoadingLista(false);
        }
      }
    }
    buscarLista();
    return () => { cancelado = true; };
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

  // ILU-95: uma ação por linha de cada vez (mesma trava do "Marcar
  // Presente"): o botão tocado mostra o carregamento e os outros da linha
  // esperam — antes, um toque duplo gravava duas vezes.
  const executarNaLinha = async (aluno, acao, executar, msgSucesso, msgErro) => {
    setMarcandoId(aluno.id_relacao || aluno.aluno_id);
    setAcaoEmAndamento(acao);
    try {
      await executar();
      showToast.success(msgSucesso);
      queryClient.invalidateQueries({ queryKey: ['agenda', 'dadosMes'] });
      setRefreshKey(old => old + 1);
      if (onAtualizar) onAtualizar();
    } catch (err) {
      showToast.error(msgErro + err.message);
    } finally {
      setMarcandoId(null);
      setAcaoEmAndamento(null);
    }
  };

  const handleRegistrarFalta = (aluno) => executarNaLinha(
    aluno, 'falta_com_aviso',
    () => agendamentoService.registrarFalta(aluno.aluno_id, aulaParaLista.id, dataLista),
    "Falta informada. Aluno removido do card.", "Erro ao registrar falta: ",
  );

  const handleDesfazerFalta = (aluno) => executarNaLinha(
    aluno, 'desfazer',
    () => agendamentoService.removerFalta(aluno.aluno_id, aulaParaLista.id, dataLista),
    "Falta removida.", "Erro ao remover falta: ",
  );

  // ILU-78: não veio e não avisou — conta no limite semanal e impede a
  // confirmação automática da reserva feita pelo app.
  const handleRegistrarFaltaSemAviso = (aluno) => executarNaLinha(
    aluno, 'falta_sem_aviso',
    () => agendamentoService.registrarFaltaSemAviso(aluno.aluno_id, aulaParaLista.id, dataLista),
    "Falta sem aviso registrada.", "Erro ao registrar falta: ",
  );

  // Marcar/desmarcar presença: admin pode fazer isso a qualquer horário,
  // direto pelo modal de chamada na Agenda (não fica preso à janela de
  // ±30min que existe na Chamada Rápida).
  const handleMarcarPresenca = async (aluno, reposicaoDeId = null) => {
    const chaveLoading = aluno.id_relacao || aluno.aluno_id;
    setMarcandoId(chaveLoading);
    setAcaoEmAndamento('presenca');
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
      setAcaoEmAndamento(null);
    }
  };

  const handleDesmarcarPresenca = async (aluno) => {
    setMarcandoId(aluno.id_relacao);
    setAcaoEmAndamento('desmarcar');
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
      setAcaoEmAndamento(null);
    }
  };

  return {
    listaPresenca, loadingLista, removendoId, marcandoId, acaoEmAndamento,
    handleRegistrarFalta, handleDesfazerFalta, handleRegistrarFaltaSemAviso,
    handleMarcarPresenca, handleDesmarcarPresenca,
    alunoParaRemover, solicitarRemocao, confirmarRemocao, cancelarRemocao, refreshKey
  };
}