import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, Search, Users, DollarSign, FileSpreadsheet, PieChart, Calendar, Wallet 
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { comissoesService } from '../services/comissoesService';
import { showToast } from '../components/shared/Toast';
import { TableSkeleton } from '../components/shared/Loading';
import EmptyState from '../components/ui/EmptyState';
import Modal, { ModalConfirmacao, useModal } from '../components/ui/Modal';
import { formatarMoeda } from '../lib/utils';

import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';

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
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <PieChart className="text-primary" size={32} /> Comissões e Repasses
          </h1>
          <p className="text-muted-foreground mt-1">Gere os extratos de pagamento consolidados dos professores.</p>
        </div>
      </div>

      {/* FILTROS */}
      <Surface variant="card" padding="lg">
        <form onSubmit={handleBuscar} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-2">
              <Users size={16} className="text-primary" /> Professor
            </label>
            <Input
              as="select"
              value={filtros.professorId}
              onChange={e => setFiltros(f => ({ ...f, professorId: e.target.value }))}
            >
              <option value="">Selecione o professor...</option>
              {professores.map(p => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Input>
          </div>
          <div className="w-full md:w-48">
            <label className="block text-xs font-black text-muted-foreground uppercase mb-2 flex items-center gap-2">
              <Calendar size={16} className="text-primary" /> Mês
            </label>
            <Input
              type="month"
              value={filtros.mesAno}
              onChange={e => setFiltros(f => ({ ...f, mesAno: e.target.value }))}
            />
          </div>
          <Button 
            type="submit"
            variant="brand"
            disabled={loading}
            className="w-full md:w-auto h-[46px] px-8 font-black gap-2"
          >
            <Search size={20} /> Buscar
          </Button>
        </form>
      </Surface>

      {/* RESULTADOS */}
      {loading ? (
        <TableSkeleton />
      ) : dados ? (
        <div className="space-y-6">
          {dados.fechamento && (
            <Surface variant="subtle" className="border border-success/20 bg-success-soft p-4 rounded-2xl flex items-center gap-3 text-success">
              <CheckCircle size={24} />
              <div>
                <p className="font-bold">Mês Fechado e Pago</p>
                <p className="text-sm opacity-80">As comissões deste mês já foram aprovadas e não podem ser alteradas.</p>
              </div>
            </Surface>
          )}

          {/* RESUMO TOTAL */}
          <div className="grid grid-cols-1 gap-6">
            <Surface variant="card" padding="lg" className="flex flex-col md:flex-row justify-between items-center shadow-lg border-primary/20">
              <div>
                <p className="text-muted-foreground font-bold uppercase text-xs mb-1">Total a Pagar (Líquido)</p>
                <h2 className="text-4xl font-black text-foreground">{formatarMoeda(dados.resumo.total_comissao)}</h2>
              </div>
              <div className="mt-4 md:mt-0 flex gap-3">
                <Button 
                  variant="outline"
                  onClick={exportarExcel}
                  className="font-bold flex items-center gap-2"
                >
                  <FileSpreadsheet size={18} /> Exportar
                </Button>
                {!dados.fechamento && dados.resumo.total_comissao > 0 && (
                  <Button 
                    onClick={modalFechamento.abrir}
                    // Mantivemos o botão verde vibrante para "Aprovar" (ação destrutiva/sucesso), 
                    // injetando tokens puros para garantir a leitura perfeita
                    className="bg-success text-success-foreground hover:bg-success/90 font-bold flex items-center gap-2 shadow-lg shadow-success/20 transition-all border-none"
                  >
                    <CheckCircle size={20} /> Aprovar Fechamento
                  </Button>
                )}
              </div>
            </Surface>
          </div>

          {/* TABELA ÚNICA DE LANÇAMENTOS */}
          <Surface variant="card" padding="none" className="overflow-hidden">
            <div className="p-6 border-b border-border flex justify-between items-center bg-muted/30">
              <h3 className="font-black text-foreground text-lg flex items-center gap-2">
                <Wallet className="text-primary" size={20} /> Extrato de Repasses
              </h3>
            </div>
            
            {dados.lancamentos.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted border-b border-border">
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Data</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Aluno</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo / Regra</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Modalidade</th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Repasse (R$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dados.lancamentos.map((l) => (
                      <tr key={l.id} className="hover:bg-subtle transition-colors group">
                        <td className="p-4 text-muted-foreground font-medium">
                          {new Date(l.created_at).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-4 font-bold text-foreground">
                          {l.alunos?.nome_completo || 'N/A'}
                        </td>
                        <td className="p-4">
                          <span className="bg-info-soft text-info px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border border-info/10">
                            {l.tipo_aula.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {l.modalidade || '-'}
                        </td>
                        <td className="p-4 font-black text-success text-right">
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
          </Surface>
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