// gestao_web/src/pages/Comissoes.jsx

import React, { useState, useEffect } from 'react';
import {
  CheckCircle, Search, Users, DollarSign, FileSpreadsheet,
  PieChart, Calendar, Wallet, RefreshCw, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { comissoesService } from '../services/comissoesService';
import { gerarRepassesMensais } from '../services/repasseService';
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
    mesAno: new Date().toISOString().slice(0, 7),
  });

  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fechando, setFechando] = useState(false);

  // Estado do fluxo de geração de repasses mensais
  const [gerando, setGerando] = useState(false);
  const [resultadoGeracao, setResultadoGeracao] = useState(null);
  const [resumoExpandido, setResumoExpandido] = useState(false);

  const modalFechamento = useModal();
  const modalGeracao = useModal();

  useEffect(() => {
    async function carregarProfessores() {
      try {
        const profs = await comissoesService.listarProfessores();
        setProfessores(profs || []);
      } catch {
        showToast.error('Erro ao carregar lista de professores');
      }
    }
    carregarProfessores();
  }, []);

  const handleBuscar = async (e) => {
    e?.preventDefault();
    if (!filtros.professorId) {
      showToast.error('Selecione um professor');
      return;
    }
    setLoading(true);
    try {
      const resultado = await comissoesService.buscarDetalhes(filtros.professorId, filtros.mesAno);
      setDados(resultado);
    } catch {
      showToast.error('Erro ao buscar detalhes das comissões');
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
        dados.resumo.total_comissao,
      );
      showToast.success('Mês fechado e comissões aprovadas com sucesso!');
      modalFechamento.fechar();
      handleBuscar();
    } catch (error) {
      console.error(error);
      showToast.error('Erro ao fechar o mês');
    } finally {
      setFechando(false);
    }
  };

  /**
   * Gera os repasses mensais com base nas matrículas ativas.
   * A edge function já previne duplicatas e retorna 409 se já foi gerado.
   */
  const handleGerarRepasses = async () => {
    const [ano, mes] = filtros.mesAno.split('-').map(Number);
    setGerando(true);
    setResultadoGeracao(null);
    try {
      const resultado = await gerarRepassesMensais(mes, ano);

      if (resultado?.jaGerados) {
        showToast.error(resultado.error || 'Repasses deste mês já foram gerados.');
        modalGeracao.fechar();
        return;
      }

      setResultadoGeracao(resultado);
      showToast.success(`${resultado.gerados} repasse(s) gerado(s) com sucesso!`);

      // Se o professor já estava selecionado, atualiza a listagem automaticamente
      if (filtros.professorId) {
        await handleBuscar();
      }
    } catch (err) {
      const msg = err?.message || 'Erro ao gerar repasses mensais.';
      showToast.error(msg);
      console.error('[Comissoes] gerarRepassesMensais:', err);
    } finally {
      setGerando(false);
      modalGeracao.fechar();
    }
  };

  const exportarExcel = () => {
    if (!dados || !dados.lancamentos.length) return;
    const linhas = dados.lancamentos.map((l) => ({
      Data: new Date(l.created_at).toLocaleDateString('pt-BR'),
      Aluno: l.alunos?.nome_completo || 'Desconhecido',
      'Tipo de Aula': l.tipo_aula.toUpperCase(),
      Modalidade: l.modalidade || '-',
      'Valor (R$)': Number(l.valor).toFixed(2).replace('.', ','),
    }));

    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comissões');
    XLSX.writeFile(wb, `Comissoes_${filtros.mesAno}_Prof_${filtros.professorId}.xlsx`);
  };

  const profSelecionado = professores.find((p) => p.id === filtros.professorId)?.nome || '';
  const mesFormatado = filtros.mesAno.split('-').reverse().join('/');

  return (
    <div className="p-8 space-y-8 animate-in fade-in max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <PieChart className="text-primary" size={32} /> Comissões e Repasses
          </h1>
          <p className="text-muted-foreground mt-1">
            Gere os extratos de pagamento consolidados dos professores.
          </p>
        </div>

        {/* Botão de geração manual */}
        <Button
          variant="brand"
          onClick={modalGeracao.abrir}
          className="flex items-center gap-2 font-black"
        >
          <RefreshCw size={18} />
          Gerar Repasses do Mês
        </Button>
      </div>

      {/* RESULTADO DA ÚLTIMA GERAÇÃO */}
      {resultadoGeracao && resultadoGeracao.sucesso && (
        <Surface
          variant="subtle"
          className="border border-success/20 bg-success-soft rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-success">
              <CheckCircle size={22} />
              <div>
                <p className="font-black">
                  {resultadoGeracao.gerados} repasse(s) gerado(s) para {resultadoGeracao.mes}
                </p>
                <p className="text-sm opacity-80">Baseado nos alunos matriculados em cada modalidade.</p>
              </div>
            </div>
            <button
              onClick={() => setResumoExpandido((v) => !v)}
              className="text-success/70 hover:text-success transition-colors p-1"
            >
              {resumoExpandido ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>

          {resumoExpandido && resultadoGeracao.resumo?.length > 0 && (
            <div className="border-t border-success/20 pt-3 space-y-1">
              {resultadoGeracao.resumo.map((r) => (
                <div key={r.nome} className="flex justify-between text-sm text-success/90">
                  <span className="font-bold">{r.nome}</span>
                  <span>
                    {r.alunos} aluno(s) · {formatarMoeda(r.total)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {resultadoGeracao.avisos?.length > 0 && (
            <div className="border-t border-warning/20 pt-3 space-y-1">
              {resultadoGeracao.avisos.map((av, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{av}</span>
                </div>
              ))}
            </div>
          )}
        </Surface>
      )}

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
              onChange={(e) => setFiltros((f) => ({ ...f, professorId: e.target.value }))}
            >
              <option value="">Selecione o professor...</option>
              {professores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
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
              onChange={(e) => setFiltros((f) => ({ ...f, mesAno: e.target.value }))}
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
            <Surface
              variant="subtle"
              className="border border-success/20 bg-success-soft p-4 rounded-2xl flex items-center gap-3 text-success"
            >
              <CheckCircle size={24} />
              <div>
                <p className="font-bold">Mês Fechado e Pago</p>
                <p className="text-sm opacity-80">
                  As comissões deste mês já foram aprovadas e não podem ser alteradas.
                </p>
              </div>
            </Surface>
          )}

          {/* RESUMO TOTAL */}
          <Surface
            variant="card"
            padding="lg"
            className="flex flex-col md:flex-row justify-between items-center shadow-lg border-primary/20"
          >
            <div>
              <p className="text-muted-foreground font-bold uppercase text-xs mb-1">
                Total a Pagar (Líquido)
              </p>
              <h2 className="text-4xl font-black text-foreground">
                {formatarMoeda(dados.resumo.total_comissao)}
              </h2>
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
                  className="bg-success text-success-foreground hover:bg-success/90 font-bold flex items-center gap-2 shadow-lg shadow-success/20 transition-all border-none"
                >
                  <CheckCircle size={20} /> Aprovar Fechamento
                </Button>
              )}
            </div>
          </Surface>

          {/* TABELA DE LANÇAMENTOS */}
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
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Data
                      </th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Aluno
                      </th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Tipo / Regra
                      </th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Modalidade
                      </th>
                      <th className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">
                        Repasse (R$)
                      </th>
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
                        <td className="p-4 text-muted-foreground">{l.modalidade || '-'}</td>
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
                <EmptyState
                  titulo="Nenhum Repasse"
                  mensagem="Não foram encontrados repasses para este professor no período selecionado."
                />
              </div>
            )}
          </Surface>
        </div>
      ) : null}

      {/* MODAL: Confirmar geração de repasses */}
      <ModalConfirmacao
        isOpen={modalGeracao.isOpen}
        onClose={modalGeracao.fechar}
        onConfirm={handleGerarRepasses}
        titulo={`Gerar Repasses — ${mesFormatado}`}
        mensagem={
          `Isso vai calcular e registrar os repasses de todos os professores com base nos ` +
          `alunos matriculados nas suas modalidades em ${mesFormatado}.\n\n` +
          `Repasses de pagamentos avulsos (confirmados manualmente) não são afetados. ` +
          `Caso já existam repasses de matrícula para este mês, a operação será bloqueada.`
        }
        loading={gerando}
      />

      {/* MODAL: Confirmar fechamento do mês */}
      <ModalConfirmacao
        isOpen={modalFechamento.isOpen}
        onClose={modalFechamento.fechar}
        onConfirm={handleFecharMes}
        titulo={`Aprovar Fechamento - ${mesFormatado}?`}
        mensagem={`Você está prestes a aprovar a comissão de ${profSelecionado} no valor total de ${
          dados ? formatarMoeda(dados.resumo.total_comissao) : ''
        }.`}
        loading={fechando}
      />
    </div>
  );
}