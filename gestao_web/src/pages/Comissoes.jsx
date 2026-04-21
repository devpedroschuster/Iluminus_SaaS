import React, { useState, useEffect } from 'react';
import { 
  Calculator, CheckCircle, Search, Users, DollarSign, FileSpreadsheet, PieChart, Wallet, Calendar, UserCheck
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
    async function carregarProfessores() {
      try {
        const profs = await comissoesService.listarProfessores();
        setProfessores(profs || []);
      } catch (error) {
        showToast.error("Erro ao carregar lista de professores.");
      }
    }
    carregarProfessores();
  }, []);

  useEffect(() => {
    if (filtros.professorId && filtros.mesAno) {
      buscarDadosComissoes();
    } else {
      setDados(null);
    }
  }, [filtros.professorId, filtros.mesAno]);

  async function buscarDadosComissoes() {
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
    setFechando(true);
    try {
      const payload = {
        professor_id: filtros.professorId,
        mes_referencia: `${filtros.mesAno}-01`,
        valor_total: dados.resumo.total_comissao,
        data_fechamento: new Date().toISOString().split('T')[0],
        status: 'pago'
      };
      await comissoesService.fecharMes(payload);
      showToast.success("Mês fechado com sucesso!");
      modalFechamento.fechar();
      buscarDadosComissoes(); 
    } catch (error) {
      showToast.error("Erro ao registrar fechamento.");
    } finally {
      setFechando(false);
    }
  }

  const exportarRelatorio = () => {
    if (!dados) return;

    const prof = professores.find(p => String(p.id) === String(filtros.professorId));
    const wb = XLSX.utils.book_new();
    

    if (dados.comissoesFixas.length > 0) {
      const dadosFixos = dados.comissoesFixas.map(c => ({
        'Aluno': c.aluno_nome,
        'Plano': c.plano_nome,
        'Modalidade': c.modalidade,
        'Valor Base Rateado': formatarMoeda(c.valor_base),
        'Taxa (%)': `${c.taxa_aplicada}%`,
        'Comissão': formatarMoeda(c.comissao)
      }));
      dadosFixos.push({ 'Aluno': 'TOTAL FIXO', 'Comissão': formatarMoeda(dados.resumo.total_fixo) });
      const wsFixos = XLSX.utils.json_to_sheet(dadosFixos);
      XLSX.utils.book_append_sheet(wb, wsFixos, "Mensalidades (Fixas)");
    }

    if (dados.comissoesVariaveis.length > 0) {
      const dadosVar = dados.comissoesVariaveis.map(c => ({
        'Data da Aula': new Date(c.data_aula + 'T12:00:00').toLocaleDateString('pt-BR'),
        'Atividade': c.atividade,
        'Alunos Avulsos': c.qtd_alunos_avulsos,
        'Valor da Aula Base': formatarMoeda(c.valor_base_unidade),
        'Taxa (%)': `${c.taxa_aplicada}%`,
        'Comissão': formatarMoeda(c.total_comissao)
      }));
      dadosVar.push({ 'Data da Aula': 'TOTAL VARIÁVEL', 'Comissão': formatarMoeda(dados.resumo.total_variavel) });
      const wsVar = XLSX.utils.json_to_sheet(dadosVar);
      XLSX.utils.book_append_sheet(wb, wsVar, "Avulsas (Presenças)");
    }
    
    XLSX.writeFile(wb, `Comissoes_${prof?.nome.replace(/\s+/g, '_')}_${filtros.mesAno}.xlsx`);
  };

 const profSelecionado = professores.find(p => String(p.id) === String(filtros.professorId))?.nome;
  const mesFormatado = filtros.mesAno.split('-').reverse().join('/');
  const temDados = dados && (dados.comissoesFixas.length > 0 || dados.comissoesVariaveis.length > 0);

  return (
    <div className="p-8 space-y-8 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800">Fechamento e Comissões</h1>
          <p className="text-gray-500">Cálculo separado por Planos Regulares (Mensalidades) e Aulas Avulsas.</p>
        </div>
        
        <div className="flex gap-3 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
           <div className="flex items-center gap-2 px-3 border-r border-gray-100">
             <Calendar size={18} className="text-gray-400" />
             <input 
                type="month" 
                className="outline-none font-bold text-gray-700 bg-transparent"
                value={filtros.mesAno}
                onChange={e => setFiltros(prev => ({...prev, mesAno: e.target.value}))}
             />
           </div>
           <div className="flex items-center gap-2 px-3">
             <Search size={18} className="text-gray-400" />
             <select 
                className="outline-none font-bold text-gray-700 bg-transparent min-w-[200px]"
                value={filtros.professorId}
                onChange={e => setFiltros(prev => ({...prev, professorId: e.target.value}))}
             >
                <option value="">Selecione o Professor...</option>
                {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
             </select>
           </div>
        </div>
      </div>

      {!filtros.professorId ? (
        <div className="bg-white p-12 rounded-[40px] border border-gray-100 shadow-sm text-center flex flex-col items-center justify-center">
          <div className="w-20 h-20 bg-orange-50 text-orange-300 rounded-full flex items-center justify-center mb-4">
            <Calculator size={40} />
          </div>
          <h3 className="text-xl font-black text-gray-800 mb-2">Selecione um Professor</h3>
          <p className="text-gray-500 max-w-md">Escolha um professor acima para iniciar o cálculo automático das comissões híbridas (Fixas + Avulsas).</p>
        </div>
      ) : loading ? (
        <TableSkeleton />
      ) : dados ? (
        <div className="space-y-6">
          
          {/* CARDS DE RESUMO */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm relative overflow-hidden group hover:border-blue-200 transition-colors md:col-span-2 flex justify-between items-center">
               <div className="relative z-10">
                 <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">Total a Pagar (Mês)</p>
                 <h2 className="text-4xl font-black text-gray-800">{formatarMoeda(dados.resumo.total_comissao)}</h2>
                 <div className="flex gap-4 mt-2">
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded">Fixo: {formatarMoeda(dados.resumo.total_fixo)}</span>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Avulsas: {formatarMoeda(dados.resumo.total_variavel)}</span>
                 </div>
               </div>
               <Wallet className="text-blue-50 opacity-50 group-hover:scale-110 transition-transform" size={80} />
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-center">
               <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-1">Alunos Regulares</p>
               <h2 className="text-3xl font-black text-gray-800 flex items-center gap-2"><UserCheck size={24} className="text-green-400"/> {dados.resumo.qtd_alunos_fixos} matrículas</h2>
            </div>

            {dados.fechamento ? (
              <div className="bg-green-50 p-6 rounded-3xl border border-green-200 flex flex-col justify-center items-center text-center">
                <CheckCircle size={32} className="text-green-500 mb-2" />
                <h3 className="font-black text-green-800 text-lg">Mês Fechado</h3>
                <p className="text-xs text-green-700 font-medium">Salvo em {new Date(dados.fechamento.data_fechamento).toLocaleDateString('pt-BR')}</p>
              </div>
            ) : (
              <button 
                onClick={modalFechamento.abrir} 
                disabled={!temDados}
                className="bg-iluminus-terracota text-white p-6 rounded-3xl shadow-lg shadow-orange-100 flex flex-col justify-center items-center hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <CheckCircle size={32} className="mb-2 group-hover:animate-pulse" />
                <h3 className="font-black text-lg">Aprovar Fechamento</h3>
              </button>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={exportarRelatorio} disabled={!temDados} className="text-sm font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-6 py-3 rounded-xl flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50">
              <FileSpreadsheet size={18} className="text-green-600"/> Exportar Relatório Excel Completo
            </button>
          </div>

          {/* TABELA 1: COMISSÕES MENSALIDADES */}
          <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 bg-green-50/30">
              <h3 className="font-black text-green-800 text-lg flex items-center gap-2">
                <UserCheck className="text-green-500"/> Comissões Fixas (Alunos Matriculados)
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">Cálculo baseado no rateio do valor do Plano Mensal pelas modalidades do aluno. Independe de presenças.</p>
            </div>

            {dados.comissoesFixas.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 text-[10px] uppercase tracking-widest text-gray-400">
                      <th className="p-4 font-black">Aluno</th>
                      <th className="p-4 font-black">Plano Ativo</th>
                      <th className="p-4 font-black">Modalidade Vinculada</th>
                      <th className="p-4 font-black text-center">Valor Base Rateado</th>
                      <th className="p-4 font-black text-center">Taxa Aplicada</th>
                      <th className="p-4 font-black text-right text-green-700">Comissão (Mês)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {dados.comissoesFixas.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 font-bold text-gray-800 text-sm">{item.aluno_nome}</td>
                        <td className="p-4 font-medium text-gray-600 text-sm">{item.plano_nome}</td>
                        <td className="p-4 font-bold text-blue-600 text-sm">{item.modalidade}</td>
                        <td className="p-4 text-center font-medium text-gray-600 text-sm">{formatarMoeda(item.valor_base)}</td>
                        <td className="p-4 text-center">
                          <span className="text-[10px] font-black uppercase px-2 py-1 rounded-md bg-gray-100 text-gray-600">{item.taxa_aplicada}%</span>
                        </td>
                        <td className="p-4 font-black text-green-600 text-right">{formatarMoeda(item.comissao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8">
                <EmptyState titulo="Nenhum Aluno Regular" mensagem="Este professor não possui alunos ativos matriculados em suas modalidades neste mês." />
              </div>
            )}
          </div>

          {/* TABELA 2: COMISSÕES VARIÁVEIS (AULAS AVULSAS/LIVRES) */}
          <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 bg-blue-50/30">
              <h3 className="font-black text-blue-800 text-lg flex items-center gap-2">
                <PieChart className="text-blue-500"/> Comissões Variáveis (Aulas Avulsas / Plano Livre)
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">Cálculo baseado EXCLUSIVAMENTE nas presenças de alunos do Plano Livre ou sem plano.</p>
            </div>

            {dados.comissoesVariaveis.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 text-[10px] uppercase tracking-widest text-gray-400">
                      <th className="p-4 font-black">Data da Aula</th>
                      <th className="p-4 font-black">Atividade na Grade</th>
                      <th className="p-4 font-black text-center">Alunos Avulsos (Presença)</th>
                      <th className="p-4 font-black text-center">Valor da Aula / Taxa</th>
                      <th className="p-4 font-black text-right text-blue-700">Comissão Gerada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {dados.comissoesVariaveis.map((aula, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 font-medium text-gray-600 text-sm">
                          {new Date(aula.data_aula + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-4 font-bold text-gray-800 text-sm">{aula.atividade}</td>
                        <td className="p-4 text-center">
                          <span className="inline-flex items-center justify-center bg-blue-100 text-blue-700 font-bold text-xs w-8 h-8 rounded-lg">
                            {aula.qtd_alunos_avulsos}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex flex-col items-center">
                             <span className="font-bold text-gray-700 text-sm">{formatarMoeda(aula.valor_base_unidade)}</span>
                             <span className="text-[9px] font-black uppercase text-gray-400 mt-1">Taxa: {aula.taxa_aplicada}%</span>
                          </div>
                        </td>
                        <td className="p-4 font-black text-blue-600 text-right">
                          {formatarMoeda(aula.total_comissao)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8">
                <EmptyState titulo="Nenhuma Aula Avulsa" mensagem="Não houve registro de alunos avulsos ou do Plano Livre nas aulas deste professor neste mês." />
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
        mensagem={`Você está prestes a aprovar a comissão de ${profSelecionado} no valor total de ${dados ? formatarMoeda(dados.resumo.total_comissao) : ''}. Esta ação marcará o mês como PAGO.`}
      />
    </div>
  );
}