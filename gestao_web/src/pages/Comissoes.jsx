import React, { useState, useEffect } from 'react';
import { 
  Calculator, CheckCircle, Search, Users, DollarSign, FileSpreadsheet, Settings, PieChart, AlertCircle, X, Wallet
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

  // Modais
  const modalFechamento = useModal();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  // Taxas
  const [taxas, setTaxas] = useState({ professor: 50, espaco: 35, diretor: 15 });
  const totalTaxas = Number(taxas.professor) + Number(taxas.espaco) + Number(taxas.diretor);
  const isTaxaValida = totalTaxas === 100;

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
      console.error(error);
      showToast.error("Erro ao calcular comissões.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFecharMes() {
    if (fechando || !dados || dados?.fechamento) return;
    setFechando(true);

    try {
      await comissoesService.fecharMes({
        professor_id: filtros.professorId,
        mes_referencia: `${filtros.mesAno}-01`,
        valor_total: dados?.resumo?.total_comissao || 0,
        quantidade_aulas: dados?.resumo?.total_aulas || 0,
        quantidade_alunos: dados?.resumo?.total_alunos || 0
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

  async function salvarConfiguracoes(e) {
    e.preventDefault();
    if (!isTaxaValida) return;
    showToast.success("Regras de comissão atualizadas com sucesso!");
    setIsConfigOpen(false);
  }

  function exportarExcel() {
    if (!dados) return;

    const prof = professores.find(p => p.id === filtros.professorId);
    const dadosPlanilha = [];

    if (dados?.mensalidades?.length > 0) {
      dadosPlanilha.push({ 'TIPO': '--- MENSALIDADES (PLANO FIXO) ---', 'DETALHE 1': '', 'DETALHE 2': '', 'VALOR': '' });
      dados.mensalidades.forEach(m => {
        dadosPlanilha.push({
          'TIPO': 'Mensalidade',
          'DETALHE 1': m.aluno,
          'DETALHE 2': m.plano,
          'VALOR': `R$ ${m.valor_comissao?.toFixed(2) || '0.00'}`
        });
      });
      dadosPlanilha.push({ 'TIPO': '', 'DETALHE 1': '', 'DETALHE 2': '', 'VALOR': '' });
    }

    if (dados?.aulas?.length > 0) {
      dadosPlanilha.push({ 'TIPO': '--- PRESENÇAS (PLANO LIVRE) ---', 'DETALHE 1': '', 'DETALHE 2': '', 'VALOR': '' });
      dados.aulas.forEach(aula => {
        dadosPlanilha.push({
          'TIPO': 'Presença',
          'DETALHE 1': `${new Date(aula.data_aula + 'T12:00:00').toLocaleDateString('pt-BR')} - ${aula.atividade}`,
          'DETALHE 2': `${aula.qtd_alunos} alunos`,
          'VALOR': `R$ ${aula.total_comissao?.toFixed(2) || '0.00'}`
        });
      });
    }

    dadosPlanilha.push({ 'TIPO': '', 'DETALHE 1': '', 'DETALHE 2': '', 'VALOR': '' });
    dadosPlanilha.push({
      'TIPO': 'TOTAL GERAL',
      'DETALHE 1': '-',
      'DETALHE 2': '-',
      'VALOR': `R$ ${dados.resumo?.total_comissao?.toFixed(2) || '0.00'}`
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
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">Comissões</h1>
          <p className="text-gray-500 font-medium text-sm">Gere relatórios, configure taxas e feche o pagamento dos professores.</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => setIsConfigOpen(true)}
            className="bg-white border border-gray-200 text-gray-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-gray-50 transition-colors"
          >
            <Settings size={20} /> Configurar Repasses
          </button>
          <button 
            disabled={!dados || (dados?.aulas?.length === 0 && dados?.mensalidades?.length === 0)}
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
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 appearance-none cursor-pointer border border-transparent focus:border-orange-200"
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
            className="w-full px-4 py-3 bg-gray-50 rounded-2xl outline-none font-bold text-gray-600 cursor-pointer border border-transparent focus:border-orange-200"
            value={filtros.mesAno}
            onChange={(e) => setFiltros({ ...filtros, mesAno: e.target.value })}
          />
        </div>
      </div>

      {!filtros.professorId ? (
        <EmptyState titulo="Selecione um Professor" mensagem="Escolha um professor acima para visualizar o detalhamento do mês." />
      ) : loading ? (
        <TableSkeleton />
      ) : dados ? (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="bg-blue-50 text-blue-600 p-4 rounded-2xl"><DollarSign size={24} /></div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase">Mensalidades (Plano Fixo)</p>
                <h3 className="text-xl font-black text-gray-800">{formatarMoeda(dados?.resumo?.total_comissao_fixo || 0)}</h3>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-4">
              <div className="bg-orange-50 text-iluminus-terracota p-4 rounded-2xl"><Users size={24} /></div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase">Presenças (Plano Livre)</p>
                <h3 className="text-xl font-black text-gray-800">{formatarMoeda(dados?.resumo?.total_comissao_livre || 0)}</h3>
              </div>
            </div>

            <div className={`p-6 rounded-[32px] border shadow-sm flex justify-between items-center ${dados?.fechamento ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-100'}`}>
              <div>
                <p className={`text-xs font-bold uppercase ${dados?.fechamento ? 'text-green-600' : 'text-purple-600'}`}>
                  {dados?.fechamento ? 'Comissão Fechada' : 'Total A Receber (Mês)'}
                </p>
                <h3 className={`text-3xl font-black ${dados?.fechamento ? 'text-green-700' : 'text-purple-700'}`}>
                  {formatarMoeda(dados?.resumo?.total_comissao || 0)}
                </h3>
              </div>
              <div className={`p-4 rounded-2xl ${dados?.fechamento ? 'bg-green-100 text-green-600' : 'bg-purple-100 text-purple-600'}`}>
                {dados?.fechamento ? <CheckCircle size={28} /> : <DollarSign size={28} />}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden flex flex-col md:flex-row">
            
            <div className="flex-1 p-8">
              
              {/* TABELA DE MENSALIDADES */}
              <div className="mb-12">
                <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                  <Wallet size={18} className="text-blue-500" /> Detalhamento de Mensalidades (Plano Fixo)
                </h3>
                
                {!dados?.mensalidades || dados.mensalidades.length === 0 ? (
                  <EmptyState titulo="Nenhuma mensalidade" mensagem="Este professor não possui comissões geradas por planos fixos neste mês." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="text-[10px] font-black uppercase text-gray-400 border-b border-gray-50">
                        <tr>
                          <th className="pb-4">Aluno</th>
                          <th className="pb-4">Plano Contratado</th>
                          <th className="pb-4 text-right">Comissão Proporcional ({taxas.professor}%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {dados.mensalidades.map((item, index) => (
                          <tr key={index} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-4 font-bold text-gray-600">{item.aluno}</td>
                            <td className="py-4 font-medium text-gray-800">{item.plano}</td>
                            <td className="py-4 text-right font-black text-blue-600">{formatarMoeda(item.valor_comissao)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* TABELA DE PRESENÇAS LIVRES */}
              <div>
                <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                  <Calculator size={18} className="text-iluminus-terracota" /> Detalhamento de Aulas (Plano Livre)
                </h3>
                
                {!dados?.aulas || dados.aulas.length === 0 ? (
                  <EmptyState titulo="Nenhuma aula registrada" mensagem="Este professor não possui presenças do plano livre neste mês." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="text-[10px] font-black uppercase text-gray-400 border-b border-gray-50">
                        <tr>
                          <th className="pb-4">Data</th>
                          <th className="pb-4">Atividade</th>
                          <th className="pb-4 text-center">Presenças (Livre)</th>
                          <th className="pb-4 text-right">Comissão ({taxas.professor}%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {dados.aulas.map((aula) => (
                          <tr key={aula.chave || Math.random()} className="hover:bg-gray-50/50 transition-colors">
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

            </div>

            <div className="w-full md:w-80 bg-gray-50 border-l border-gray-100 p-8 flex flex-col justify-center items-center text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm text-gray-400 mb-4">
                <DollarSign size={32} />
              </div>
              <h4 className="font-black text-gray-800 mb-1">Pagamento</h4>
              <p className="text-xs text-gray-500 font-medium mb-6">
                Chave PIX: <span className="font-bold text-gray-700 block mt-1">{profSelecionado?.pix_comissao || 'Não cadastrada'}</span>
              </p>

              {(dados?.aulas?.length > 0 || dados?.mensalidades?.length > 0) && (
                dados?.fechamento ? (
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

      {isConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-black text-gray-800">Configurar Repasses (%)</h2>
              <button onClick={() => setIsConfigOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="p-6">
              <form onSubmit={salvarConfiguracoes} className="space-y-6">
                <div className="flex items-center gap-2 bg-blue-50 text-blue-700 p-4 rounded-2xl text-sm font-medium">
                  <PieChart size={20} className="shrink-0" />
                  <p>Defina como o valor recebido será dividido. A soma deve ser sempre 100%.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase flex justify-between mb-2">
                      <span>Professor</span>
                      <span className="text-gray-600">{taxas.professor}%</span>
                    </label>
                    <input 
                      type="number" min="0" max="100"
                      className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 border border-gray-100 focus:border-blue-300 transition-all"
                      value={taxas.professor} onChange={(e) => setTaxas({...taxas, professor: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase flex justify-between mb-2">
                      <span>Espaço Iluminus</span>
                      <span className="text-gray-600">{taxas.espaco}%</span>
                    </label>
                    <input 
                      type="number" min="0" max="100"
                      className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 border border-gray-100 focus:border-orange-300 transition-all"
                      value={taxas.espaco} onChange={(e) => setTaxas({...taxas, espaco: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase flex justify-between mb-2">
                      <span>Direção</span>
                      <span className="text-gray-600">{taxas.diretor}%</span>
                    </label>
                    <input 
                      type="number" min="0" max="100"
                      className="w-full p-4 bg-gray-50 rounded-2xl outline-none font-bold text-gray-700 border border-gray-100 focus:border-purple-300 transition-all"
                      value={taxas.diretor} onChange={(e) => setTaxas({...taxas, diretor: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-gray-400 uppercase">Soma Total</span>
                    <span className={`text-sm font-black ${isTaxaValida ? 'text-green-500' : 'text-red-500'}`}>{totalTaxas}%</span>
                  </div>
                  <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden flex">
                    <div style={{ width: `${(taxas.professor / Math.max(100, totalTaxas)) * 100}%` }} className="bg-blue-400 transition-all"></div>
                    <div style={{ width: `${(taxas.espaco / Math.max(100, totalTaxas)) * 100}%` }} className="bg-orange-400 transition-all"></div>
                    <div style={{ width: `${(taxas.diretor / Math.max(100, totalTaxas)) * 100}%` }} className="bg-purple-400 transition-all"></div>
                  </div>
                  {!isTaxaValida && (
                    <p className="text-xs font-bold text-red-500 flex items-center gap-1 mt-2">
                      <AlertCircle size={14} /> A soma deve ser exatamente 100%.
                    </p>
                  )}
                </div>

                <button 
                  type="submit" 
                  disabled={!isTaxaValida}
                  className="w-full bg-gray-800 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Salvar Regras
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <ModalConfirmacao 
        isOpen={modalFechamento.isOpen}
        onClose={modalFechamento.fechar}
        onConfirm={handleFecharMes}
        titulo={`Fechar Comissões - ${mesFormatado}?`}
        mensagem={`Você está prestes a fechar a comissão de ${profSelecionado?.nome} no valor de ${dados ? formatarMoeda(dados?.resumo?.total_comissao || 0) : ''}. Esta ação marcará o mês como PAGO no sistema.`}
        tipo="primary"
      />
    </div>
  );
}