import React, { useState, useMemo, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, CreditCard, Smartphone, 
  Banknote, Clock, CheckCircle, Search, RefreshCw, AlertCircle, Calendar, FileSpreadsheet, Plus
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

// Hooks e Serviços
import { financeiroService } from '../services/financeiroService';
import { useFinanceiro } from '../hooks/useFinanceiro';

// Componentes Novos e Constantes
import SelectFormaPagamento from '../components/SelectFormaPagamento';
import RepasseAlunoCard from '../components/RepasseAlunoCard';
import { TIPOS_AULA } from '../lib/constants';

// Componentes Compartilhados
import { showToast } from '../components/shared/Toast';
import Modal, { useModal, ModalConfirmacao } from '../components/shared/Modal';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/shared/EmptyState';
import ModalAdicionarPagamentoManual from '../components/ModalAdicionarPagamentoManual';
import { formatarMoeda } from '../lib/utils';

export default function Financeiro() {
  const dataAtual = new Date();
  const [filtros, setFiltros] = useState({
    mes: dataAtual.getMonth() + 1,
    ano: dataAtual.getFullYear()
  });

  const { mensalidades, loading, refetch } = useFinanceiro(filtros);
  const [busca, setBusca] = useState('');
  
  // Modais
  const modalPagamento = useModal();
  const modalResultado = useModal();
  const modalGerarMensalidades = useModal();
  const [modalAddOpen, setModalAddOpen] = useState(false);

  // Estados do Formulário
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState(null);
  const [valorPago, setValorPago] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('');
  const [tipoAula, setTipoAula] = useState('regular');
  const [professorId, setProfessorId] = useState('');
  const [modalidadeNome, setModalidadeNome] = useState('');
  
  const [professores, setProfessores] = useState([]);
  const [resultadoRepasse, setResultadoRepasse] = useState(null);
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    async function carregarProfessores() {
      const { data } = await supabase.from('professores').select('id, nome').eq('ativo', true);
      if (data) setProfessores(data);
    }
    carregarProfessores();
  }, []);

  const metricas = useMemo(() => {
    if (!mensalidades) return { recebido: 0, pendente: 0, atrasado: 0, total: 0 };
    const hoje = new Date().toISOString().split('T')[0];
    
    return mensalidades.reduce((acc, m) => {
      const valorOriginal = Number(m.planos?.preco) || 0;
      const valorReal = m.valor_pago !== null ? Number(m.valor_pago) : valorOriginal;
      
      if (m.status === 'pago') {
        acc.recebido += valorReal;
        acc.total += valorReal;
      } else if (m.data_vencimento < hoje) {
        acc.atrasado += valorOriginal;
        acc.total += valorOriginal;
      } else {
        acc.pendente += valorOriginal;
        acc.total += valorOriginal;
      }
      return acc;
    }, { recebido: 0, pendente: 0, atrasado: 0, total: 0 });
  }, [mensalidades]);

  const handleAbrirPagamento = (mensalidade) => {
    setPagamentoSelecionado(mensalidade);
    setValorPago(mensalidade.planos?.preco?.toString() || '');
    setFormaPagamento('');
    setTipoAula('regular');
    setProfessorId('');
    setModalidadeNome('');
    modalPagamento.abrir();
  };

  const handleConfirmarPagamento = async (e) => {
    e.preventDefault();
    try {
      const valorFormatado = parseFloat(valorPago.replace(/\./g, '').replace(',', '.'));
      const payload = {
        valor_pago: valorFormatado,
        forma_pagamento: formaPagamento,
        tipo_aula: tipoAula,
        professor_id: (tipoAula === 'experimental' || tipoAula === 'avulsa') ? professorId : null,
        modalidade_nome: (tipoAula === 'experimental' || tipoAula === 'avulsa') ? modalidadeNome : null
      };

      const res = await financeiroService.confirmarPagamento(pagamentoSelecionado.id, payload);
      showToast.success('Pagamento processado com sucesso!');
      refetch();
      modalPagamento.fechar();
      setResultadoRepasse(res.resultado);
      modalResultado.abrir();
    } catch (error) {
      showToast.error("Erro ao processar pagamento");
    }
  };

  const handleGerarMensalidades = async () => {
    setGerando(true);
    try {
      await financeiroService.gerarMensalidades(filtros.mes - 1, filtros.ano);
      showToast.success('Cobranças geradas para os alunos ativos!');
      refetch();
      modalGerarMensalidades.fechar();
    } catch (error) {
      showToast.error('Erro ao gerar cobranças');
    } finally {
      setGerando(false);
    }
  };

  const alunosFiltrados = mensalidades?.filter(m => {
    const nomeBase = m.alunos?.nome_completo || m.nome_visitante || '';
    return nomeBase.toLowerCase().includes(busca.toLowerCase());
  });

  return (
    <div className="p-8 space-y-8 animate-in fade-in max-w-7xl mx-auto">
      {/* Header com Ações */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-800 flex items-center gap-3">
            <DollarSign className="text-iluminus-terracota" size={32} /> Financeiro
          </h1>
          <p className="text-gray-500 mt-1">Gestão de mensalidades e repasses profissionais.</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button 
            onClick={modalGerarMensalidades.abrir}
            className="flex-1 md:flex-none bg-gray-100 text-gray-700 px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
          >
            <RefreshCw size={20} /> Gerar Cobranças
          </button>
          <button 
  onClick={() => setModalAddOpen(true)}
  className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-green-700 transition-all"
>
  <Plus size={20} /> Novo Lançamento
</button>
        </div>
      </div>

      {/* Cartões Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <CardMetrica titulo="Recebido" valor={metricas.recebido} icone={<CheckCircle />} cor="green" />
        <CardMetrica titulo="Pendente" valor={metricas.pendente} icone={<Clock />} cor="orange" />
        <CardMetrica titulo="Atrasado" valor={metricas.atrasado} icone={<AlertCircle />} cor="red" />
        <CardMetrica titulo="Total Mês" valor={metricas.total} icone={<TrendingUp />} cor="blue" />
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex gap-2">
          <select 
            value={filtros.mes} 
            onChange={(e) => setFiltros({...filtros, mes: parseInt(e.target.value)})}
            className="bg-gray-50 border-none rounded-xl px-4 py-3 font-bold text-gray-700 focus:ring-2 focus:ring-iluminus-terracota/20"
          >
            {Array.from({length: 12}, (_, i) => (
              <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString('pt-BR', {month: 'long'})}</option>
            ))}
          </select>
          <select 
            value={filtros.ano} 
            onChange={(e) => setFiltros({...filtros, ano: parseInt(e.target.value)})}
            className="bg-gray-50 border-none rounded-xl px-4 py-3 font-bold text-gray-700 focus:ring-2 focus:ring-iluminus-terracota/20"
          >
            {[2024, 2025, 2026].map(ano => <option key={ano} value={ano}>{ano}</option>)}
          </select>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text"
            placeholder="Buscar aluno..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-iluminus-terracota/20 font-medium"
          />
        </div>
      </div>

      {/* Tabela Mensalidades */}
      {loading ? <TableSkeleton /> : alunosFiltrados?.length > 0 ? (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 font-bold text-gray-400 uppercase text-xs">Aluno</th>
                <th className="p-4 font-bold text-gray-400 uppercase text-xs">Vencimento</th>
                <th className="p-4 font-bold text-gray-400 uppercase text-xs">Valor</th>
                <th className="p-4 font-bold text-gray-400 uppercase text-xs">Status</th>
                <th className="p-4 font-bold text-gray-400 uppercase text-xs text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {alunosFiltrados.map((item) => (
                <tr key={item.id} className="hover:bg-orange-50/30 transition-colors">
                  <td className="p-4 font-bold text-gray-700 flex items-center gap-2">
                    {item.alunos?.nome_completo || item.nome_visitante || 'Visitante'}
                    {!item.alunos && item.nome_visitante && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[9px] rounded-md uppercase tracking-wider">Avulso</span>
                    )}
                  </td>
                  <td className="p-4 text-gray-500 font-medium">
                    {new Date(item.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className="p-4 font-bold text-gray-700">
                    {item.status === 'pago' 
                      ? formatarMoeda(item.valor_pago !== null ? item.valor_pago : item.planos?.preco) 
                      : formatarMoeda(item.planos?.preco)}
                  </td>
                  <td className="p-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${item.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {item.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {item.status !== 'pago' && (
                      <button 
                        onClick={() => handleAbrirPagamento(item)}
                        className="bg-iluminus-terracota text-white px-4 py-2 rounded-xl font-bold text-sm hover:opacity-90"
                      >
                        Receber
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState titulo="Nenhum registro" mensagem="Não há mensalidades para o período selecionado." />}

      {/* Modal Pagamento */}
      <Modal isOpen={modalPagamento.isOpen} onClose={modalPagamento.fechar} titulo="Confirmar Recebimento">
        {pagamentoSelecionado && (
          <form onSubmit={handleConfirmarPagamento} className="space-y-6">
            <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
              <p className="text-sm text-gray-600 font-medium">Aluno</p>
              <p className="font-black text-gray-800 text-lg">
    {pagamentoSelecionado.alunos?.nome_completo || pagamentoSelecionado.nome_visitante || 'Visitante'}
  </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Valor (R$)</label>
                <input type="text" value={valorPago} onChange={(e) => setValorPago(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-bold" required />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Forma</label>
                <SelectFormaPagamento value={formaPagamento} onChange={setFormaPagamento} required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Tipo de Aula</label>
              <select value={tipoAula} onChange={(e) => setTipoAula(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-3">
                {TIPOS_AULA.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>
            {(tipoAula === 'experimental' || tipoAula === 'avulsa') && (
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border">
                <select value={professorId} onChange={(e) => setProfessorId(e.target.value)} className="border rounded-lg p-2 text-sm" required>
                  <option value="">Professor...</option>
                  {professores.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
                <input type="text" value={modalidadeNome} onChange={(e) => setModalidadeNome(e.target.value)} placeholder="Modalidade..." className="border rounded-lg p-2 text-sm" required />
              </div>
            )}
            <button type="submit" className="w-full bg-iluminus-terracota text-white py-4 rounded-2xl font-black">Confirmar Recebimento</button>
          </form>
        )}
      </Modal>

      {/* Modal Sucesso e Repasse */}
      <Modal isOpen={modalResultado.isOpen} onClose={modalResultado.fechar} titulo="Repasse Processado">
        {resultadoRepasse && pagamentoSelecionado && (
          <div className="space-y-6">
            <RepasseAlunoCard aluno={pagamentoSelecionado.alunos} mensalidade={{ tipo_aula: tipoAula }} resultado={resultadoRepasse} /><RepasseAlunoCard 
    aluno={pagamentoSelecionado.alunos || { nome_completo: pagamentoSelecionado.nome_visitante || 'Visitante' }} 
    mensalidade={{ tipo_aula: tipoAula }} 
    resultado={resultadoRepasse} 
  />
            <button onClick={modalResultado.fechar} className="w-full bg-gray-100 py-3 rounded-xl font-bold">Fechar</button>
          </div>
        )}
      </Modal>

      <ModalConfirmacao 
        isOpen={modalGerarMensalidades.isOpen} onClose={modalGerarMensalidades.fechar} onConfirm={handleGerarMensalidades}
        titulo="Gerar Cobranças" mensagem="Deseja gerar as cobranças para todos os alunos ativos deste mês?"
      />
      <ModalAdicionarPagamentoManual 
        isOpen={modalAddOpen} 
        onClose={() => setModalAddOpen(false)}
        onSucesso={refetch} 
      />
    </div>
  );
}

const CardMetrica = ({ titulo, valor, icone, cor }) => {
  const cores = {
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    blue: "bg-blue-50 text-blue-600",
    red: "bg-red-50 text-red-600"
  };
  return (
    <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-4">
      <div className={`p-4 rounded-2xl ${cores[cor]}`}>{React.cloneElement(icone, { size: 24 })}</div>
      <div>
        <p className="text-gray-400 text-sm font-bold uppercase">{titulo}</p>
        <p className="text-2xl font-black text-gray-800">{formatarMoeda(valor)}</p>
      </div>
    </div>
  );
};