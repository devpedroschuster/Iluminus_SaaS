import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, Search, Users, DollarSign, FileSpreadsheet, PieChart, Calendar, Wallet 
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { comissoesService } from '../services/comissoesService';
import { showToast } from '../components/shared/Toast';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import Modal, { ModalConfirmacao, useModal } from '../components/shared/Modal';
import { formatarMoeda } from '../lib/utils';

export default function Comissoes() {
  const [professores, setProfessores] = useState([]);
  const [filtros, setFiltros] = useState({
    professorId: '',
    mesAno: new Date().toISOString().slice(0, 7)
  });
  
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fechando, setFechando] = useState(false);

  const modalFechamento = useModal();

  useEffect(() => {
    async function carregarProfessores() {
      try {
        const profs = await comissoesService.listarProfessores();
        setProfessores(profs || []);
      } catch (error) {
        showToast.error("Erro ao carregar lista de professores");
      }
    }
    carregarProfessores();
  }, []);

  const handleBuscar = async (e) => {
    e?.preventDefault();
    if (!filtros.professorId) {
      showToast.error("Selecione um professor");
      return;
    }

    setLoading(true);
    try {
      const resultado = await comissoesService.buscarDetalhes(filtros.professorId, filtros.mesAno);
      setDados(resultado);
    } catch (error) {
      showToast.error("Erro ao buscar detalhes das comissões");
    } finally {
      setLoading(false);
    }
  };

  const handleFecharMes = async () => {
    setFechando(true);
    try {
      await comissoesService.fecharMes(
        filtros.professorId, 
        filtros.mesAno, 
        dados.resumo.total_comissao
      );
      
      showToast.success("Mês fechado e comissões aprovadas com sucesso!");
      modalFechamento.fechar();
      handleBuscar();
    } catch (error) {
      console.error(error);
      showToast.error("Erro ao fechar o mês");
    } finally {
      setFechando(false);
    }
  };

  const exportarExcel = () => {
    if (!dados || !dados.lancamentos.length) return;
    const linhas = dados.lancamentos.map(l => ({
      Data: new Date(l.created_at).toLocaleDateString('pt-BR'),
      Aluno: l.alunos?.nome_completo || 'Desconhecido',
      'Tipo de Aula': l.tipo_aula.toUpperCase(),
      Modalidade: l.modalidade || '-',
      'Valor (R$)': Number(l.valor).toFixed(2).replace('.', ',')
    }));

    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comissões");
    XLSX.writeFile(wb, `Comissoes_${filtros.mesAno}_Prof_${filtros.professorId}.xlsx`);
  };

  const profSelecionado = professores.find(p => p.id === filtros.professorId)?.nome || '';
  const mesFormatado = filtros.mesAno.split('-').reverse().join('/');

  return (
    <div className="p-8 space-y-8 animate-in fade-in max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 flex items-center gap-3">
            <PieChart className="text-iluminus-terracota" size={32} /> Comissões e Repasses
          </h1>
          <p className="text-gray-500 mt-1">Gere os extratos de pagamento consolidados dos professores.</p>
        </div>
      </div>

      {/* FILTROS */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <form onSubmit={handleBuscar} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
              <Users size={16} className="text-iluminus-terracota" /> Professor
            </label>
            <select
              value={filtros.professorId}
              onChange={e => setFiltros(f => ({ ...f, professorId: e.target.value }))}
              className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-iluminus-terracota/20 font-medium text-gray-700"
            >
              <option value="">Selecione o professor...</option>
              {professores.map(p => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div className="w-full md:w-48">
            <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
              <Calendar size={16} className="text-iluminus-terracota" /> Mês
            </label>
            <input
              type="month"
              value={filtros.mesAno}
              onChange={e => setFiltros(f => ({ ...f, mesAno: e.target.value }))}
              className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-iluminus-terracota/20 font-medium text-gray-700"
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full md:w-auto bg-iluminus-terracota text-white px-8 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Search size={20} /> Buscar
          </button>
        </form>
      </div>

      {/* RESULTADOS */}
      {loading ? (
        <TableSkeleton />
      ) : dados ? (
        <div className="space-y-6">
          {dados.fechamento && (
            <div className="bg-green-50 border border-green-200 p-4 rounded-2xl flex items-center gap-3 text-green-700">
              <CheckCircle size={24} />
              <div>
                <p className="font-bold">Mês Fechado e Pago</p>
                <p className="text-sm opacity-80">As comissões deste mês já foram aprovadas e não podem ser alteradas.</p>
              </div>
            </div>
          )}

          {/* RESUMO TOTAL */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-6 rounded-[32px] text-white shadow-lg col-span-1 md:col-span-3 flex flex-col md:flex-row justify-between items-center">
              <div>
                <p className="text-gray-400 font-medium mb-1">Total a Pagar (Líquido)</p>
                <h2 className="text-4xl font-black text-white">{formatarMoeda(dados.resumo.total_comissao)}</h2>
              </div>
              <div className="mt-4 md:mt-0 flex gap-3">
                <button 
                  onClick={exportarExcel}
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2 transition-colors"
                >
                  <FileSpreadsheet size={18} /> Exportar
                </button>
                {!dados.fechamento && dados.resumo.total_comissao > 0 && (
                  <button 
                    onClick={modalFechamento.abrir}
                    className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-500/30"
                  >
                    <CheckCircle size={20} /> Aprovar Fechamento
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* TABELA ÚNICA DE LANÇAMENTOS */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
                <Wallet className="text-iluminus-terracota" size={20} /> Extrato de Repasses
              </h3>
            </div>
            
            {dados.lancamentos.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Data</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Aluno</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Tipo / Regra</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Modalidade</th>
                      <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Repasse (R$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {dados.lancamentos.map((l) => (
                      <tr key={l.id} className="hover:bg-orange-50/30 transition-colors group">
                        <td className="p-4 text-gray-500 font-medium">
                          {new Date(l.created_at).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-4 font-bold text-gray-700">
                          {l.alunos?.nome_completo || 'N/A'}
                        </td>
                        <td className="p-4">
                          <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-md text-xs font-bold uppercase">
                            {l.tipo_aula.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-4 text-gray-500">
                          {l.modalidade || '-'}
                        </td>
                        <td className="p-4 font-black text-green-600 text-right">
                          {formatarMoeda(l.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8">
                <EmptyState titulo="Nenhum Repasse" mensagem="Não foram encontrados repasses para este professor no período selecionado." />
              </div>
            )}
          </div>
        </div>
      ) : null}

      <ModalConfirmacao 
        isOpen={modalFechamento.isOpen}
        onClose={modalFechamento.fechar}
        onConfirm={handleFecharMes}
        titulo={`Aprovar Fechamento - ${mesFormatado}?`}
        mensagem={`Você está prestes a aprovar a comissão de ${profSelecionado} no valor total de ${dados ? formatarMoeda(dados.resumo.total_comissao) : ''}.`}
      />
    </div>
  );
}