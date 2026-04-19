import { useState } from 'react';
import { agendaService } from '../../../services/agendaService';
import { showToast } from '../../../components/shared/Toast';

export function useFeriados(refetch) {
  const [novoFeriado, setNovoFeriado] = useState({ data: '', descricao: '' });
  const [savingFeriado, setSavingFeriado] = useState(false);

  async function salvarFeriado(e) {
    e.preventDefault();
    if (savingFeriado) return;
    setSavingFeriado(true);
    try {
      await agendaService.cadastrarFeriado(novoFeriado);
      showToast.success("Bloqueio adicionado na agenda!");
      setNovoFeriado({ data: '', descricao: '' });
      refetch();
    } catch (err) {
      showToast.error("Erro ao salvar bloqueio.");
    } finally {
      setSavingFeriado(false);
    }
  }

  async function deletarFeriado(id) {
    if (!window.confirm("Tem certeza que deseja remover este bloqueio?")) return;
    try {
      await agendaService.excluirFeriado(id);
      showToast.success("Bloqueio removido.");
      refetch();
    } catch (err) {
      showToast.error("Erro ao remover bloqueio.");
    }
  }

  return { novoFeriado, setNovoFeriado, savingFeriado, salvarFeriado, deletarFeriado };
}