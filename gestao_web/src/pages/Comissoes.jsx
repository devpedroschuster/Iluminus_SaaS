import React, { useState, useEffect } from 'react';
import { 
  Calculator, Download, CheckCircle, Search, CalendarDays, Users, DollarSign, FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { comissoesService } from '../services/comissoesService';

import { showToast } from '../components/shared/Toast';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import { ModalConfirmacao, useModal } from '../components/shared/Modal';
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
    carregarProfessores();
  }, []);

  useEffect(() => {
    if (filtros.professorId && filtros.mesAno) {
      buscarDados();
    } else {
      setDados(null);
    }
  }, [filtros]);

  async function carregarProfessores() {
    try {
      const lista = await comissoesService.listarProfessores();
      setProfessores(lista || []);
    } catch (error) {
      showToast.error("Erro ao carregar lista de professores.");
    }
  }

  async function buscarDados() {
    setLoading(true);
    try {
      const resultado = await comissoesService.buscarDetalhes(filtros.professorId, filtros.mesAno);
      setDados(resultado);
    } catch (error) {
      showToast.error("Erro ao calcular comissões.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFecharMes() {
    if (fechando || !dados || dados.fechamento) return;
    setFechando(true);

    try {
      await comissoesService.fecharMes({
        professor_id: filtros.professorId,
        mes_referencia: `${filtros.mesAno}-01`,
        valor_total: dados.resumo.total_comissao,
        quantidade_aulas: dados.resumo.total_aulas,
        quantidade_alunos: dados.resumo.total_alunos
      });
      
      showToast.success("Mês fechado com sucesso! Comissão registrada.");
      modalFechamento.fechar();
      buscarDados();
    } catch (error) {
      showToast.error("Erro ao fechar comissão.");
    } finally {
      setFechando(false);
    }
  }

  function exportarExcel() {
    if (!dados || dados.aulas.length === 0) return;

    const prof = professores.find(p => p.id === filtros.professorId);
    
    const dadosPlanilha = dados.aulas.map(aula => ({
      'Data da Aula': new Date(aula.data_aula + 'T12:00:00').toLocaleDateString('pt-BR'),
      'Atividade': aula.atividade,
      'Alunos Presentes': aula.qtd_alunos,
      'Valor Base (Aluno)': `R$ ${aula.valor_base.toFixed(2)}`,
      'Comissão Gerada': `R$ ${aula.total_comissao.toFixed(2)}`
    }));

    dadosPlanilha.push({
      'Data da Aula': 'TOTAL',
      'Atividade': '-',
      'Alunos Presentes': dados.resumo.total_alunos,
      'Valor Base (Aluno)': '-',
      'Comissão Gerada': `R$ ${dados.resumo.total_comissao.toFixed(2)}`
    });

    const worksheet = XLSX.utils.json_to_sheet(dadosPlanilha);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Comissões");
    
    XLSX.writeFile(workbook, `Comissoes_${prof?.nome}_${filtros.mesAno}.xlsx`);
    showToast.success("Planilha exportada com sucesso!");
  }

  const profSelecionado = professores.find(p => p.id === filtros.professorId);
  const mesFormatado = filtros.mesAno.split('-').reverse().join('/');

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Fechamento de Comissões</h1>
          <p className="text-gray-500 font-medium text-sm">Gere relatórios e feche o pagamento dos professores (Dança).</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            disabled={!dados || dados.aulas.length === 0}
            onClick={exportarExcel}
            className="bg-green-50 text-green-700 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet size={20} /> Exportar Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 bg-white p-4 rounded-[28px] border border-gray-100 shadow-sm">
        <div className="flex-1 min-w-[250px] relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
          <select 
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none cursor-pointer"
            value={filtros.professorId}
            onChange={(e) => setFiltros({ ...filtros, professorId: e.target.value })}
          >
            <option value="">Selecione o Professor...</option>
            {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        
        <div className="min-w-[200px] relative">
          <input 
            type="month" 
            className="w-full px-4 py-3 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 cursor-pointer"
            value={filtros.mesAno}
            onChange={(e) => setFiltros({ ...filtros, mesAno: e.target.value })}
          />
        </div>
      </div>

      {!filtros.professorId ? (
        <EmptyState titulo="Selecione um Professor" mensagem="Escolha um professor acima para calcular as comissões do mês." />
      ) : loading ? (
        <TableSkeleton />
      ) : dados ? (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="bg-blue-50 text-blue-600 p-4 rounded-2xl"><CalendarDays size={24} /></div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase">Aulas Dadas</p>
                <h3 className="text-2xl font-black text-gray-800">{dados.resumo.total_aulas}</h3>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="bg-orange-50 text-iluminus-terracota p-4 rounded-2xl"><Users size={24} /></div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase">Total de Presenças</p>
                <h3 className="text-2xl font-black text-gray-800">{dados.resumo.total_alunos}</h3>
              </div>
            </div>

            <div className={`p-6 rounded-[32px] border shadow-sm flex justify-between items-center ${dados.fechamento ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-100'}`}>
              <div>
                <p className={`text-xs font-bold uppercase ${dados.fechamento ? 'text-green-600' : 'text-purple-600'}`}>
                  {dados.fechamento ? 'Comissão Fechada' : 'A Receber (Mês)'}
                </p>
                <h3 className={`text-3xl font-black ${dados.fechamento ? 'text-green-700' : 'text-purple-700'}`}>
                  {formatarMoeda(dados.resumo.total_comissao)}
                </h3>
              </div>
              <div className={`p-4 rounded-2xl ${dados.fechamento ? 'bg-green-100 text-green-600' : 'bg-purple-100 text-purple-600'}`}>
                {dados.fechamento ? <CheckCircle size={28} /> : <DollarSign size={28} />}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden flex flex-col md:flex-row">
            
            <div className="flex-1 p-8">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                <Calculator size={18} className="text-gray-400" /> Detalhamento de Aulas
              </h3>
              
              {dados.aulas.length === 0 ? (
                <EmptyState titulo="Nenhuma aula registrada" mensagem="Este professor não possui presenças registradas em aulas de dança neste mês." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="text-[10px] font-black uppercase text-gray-400 border-b border-gray-50">
                      <tr>
                        <th className="pb-4">Data</th>
                        <th className="pb-4">Atividade</th>
                        <th className="pb-4 text-center">Presenças</th>
                        <th className="pb-4 text-right">Comissão (50%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {dados.aulas.map((aula) => (
                        <tr key={aula.chave} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 font-bold text-gray-600">{new Date(aula.data_aula + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</td>
                          <td className="py-4 font-medium text-gray-800">{aula.atividade}</td>
                          <td className="py-4 text-center font-bold text-gray-600">{aula.qtd_alunos}</td>
                          <td className="py-4 text-right font-black text-iluminus-terracota">{formatarMoeda(aula.total_comissao)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="w-full md:w-80 bg-gray-50 border-l border-gray-100 p-8 flex flex-col justify-center items-center text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm text-gray-400 mb-4">
                <DollarSign size={32} />
              </div>
              <h4 className="font-black text-gray-800 mb-1">Pagamento</h4>
              <p className="text-xs text-gray-500 font-medium mb-6">
                Chave PIX: <span className="font-bold text-gray-700 block mt-1">{profSelecionado?.pix_comissao || 'Não cadastrada'}</span>
              </p>

              {dados.aulas.length > 0 && (
                dados.fechamento ? (
                  <div className="w-full bg-green-100 text-green-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-2">
                    <CheckCircle size={18} /> Fechado em {new Date(dados.fechamento.created_at).toLocaleDateString('pt-BR')}
                  </div>
                ) : (
                  <button 
                    onClick={modalFechamento.abrir}
                    className="w-full bg-gray-800 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-gray-700 transition-all hover:scale-[1.02]"
                  >
                    Fechar Mês
                  </button>
                )
              )}
            </div>
            
          </div>
        </div>
      ) : null}

      <ModalConfirmacao 
        isOpen={modalFechamento.isOpen}
        onClose={modalFechamento.fechar}
        onConfirm={handleFecharMes}
        titulo={`Fechar Comissões - ${mesFormatado}?`}
        mensagem={`Você está prestes a fechar a comissão de ${profSelecionado?.nome} no valor de ${dados ? formatarMoeda(dados.resumo.total_comissao) : ''}. Esta ação marcará o mês como PAGO no sistema.`}
        tipo="primary"
      />
    </div>
  );
}