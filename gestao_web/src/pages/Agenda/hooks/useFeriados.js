import { useState } from 'react';
import { gradeService } from '../../../services/gradeService';
import { showToast } from '../../../components/shared/Toast';

export function useFeriados(refetch) {
  const [novoFeriado, setNovoFeriado] = useState({ data: '', descricao: '' });
  const [savingFeriado, setSavingFeriado] = useState(false);
  const [feriadoParaExcluir, setFeriadoParaExcluir] = useState(null);

  async function salvarFeriado(e) {
    e.preventDefault();
    if (savingFeriado) return;
    setSavingFeriado(true);
    try {
      await gradeService.cadastrarFeriado(novoFeriado);
      showToast.success("Bloqueio adicionado na agenda!");
      setNovoFeriado({ data: '', descricao: '' });
      refetch();
    } catch (err) {
      showToast.error("Erro ao salvar bloqueio.");
    } finally {
      setSavingFeriado(false);
    }
  }

  const solicitarExclusao = (id) => setFeriadoParaExcluir(id);
  const cancelarExclusao = () => setFeriadoParaExcluir(null);

  async function confirmarExclusao() {
    if (!feriadoParaExcluir) return;
    try {
      await gradeService.excluirFeriado(feriadoParaExcluir);
      showToast.success("Bloqueio removido.");
      refetch();
    } catch (err) {
      showToast.error("Erro ao remover bloqueio.");
    } finally {
      setFeriadoParaExcluir(null);
    }
  }

  return { 
    novoFeriado, setNovoFeriado, savingFeriado, salvarFeriado, 
    feriadoParaExcluir, solicitarExclusao, confirmarExclusao, cancelarExclusao 
  };
}