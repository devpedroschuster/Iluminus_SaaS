import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  User, CreditCard, Calendar, Activity,
  ArrowLeft, ExternalLink, FileText, CheckCircle, MapPin, Edit2
} from 'lucide-react';
import { alunosService } from '../services/alunosService';
import { TableSkeleton } from '../components/shared/Loading';
import { showToast } from '../components/shared/Toast';
import ModalRenovarPlano from '../components/ModalRenovarPlano';

import Surface from '../components/ui/Surface';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';

const LabelDado = ({ titulo, valor }) => (
  <div className="space-y-1">
    <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest block">
      {titulo}
    </label>
    <p className="font-bold text-foreground">
      {valor ?? <span className="text-muted-foreground italic font-medium">Não informado</span>}
    </p>
  </div>
);

const Th = ({ children, className = '' }) => (
  <th className={`p-5 text-[10px] font-black uppercase text-muted-foreground tracking-widest ${className}`}>
    {children}
  </th>
);

export default function PerfilAluno() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [abaAtiva, setAbaAtiva] = useState('resumo');
  const [modalRenovarAberto, setModalRenovarAberto] = useState(false);
  const [observacoesMedicas, setObservacoesMedicas] = useState('');
  const [salvandoMedico, setSalvandoMedico] = useState(false);

  const { data: aluno, isLoading: loadingAluno } = useQuery({
    queryKey: ['aluno', id],
    queryFn: () => alunosService.buscarPerfilCompleto(id),
  });

  const { data: planos } = useQuery({
    queryKey: ['aluno-planos', id],
    queryFn: () => alunosService.buscarHistoricoPlanos(id),
    enabled: !!aluno,
  });

  const { data: frequencia } = useQuery({
    queryKey: ['aluno-frequencia', id],
    queryFn: () => alunosService.buscarHistoricoFrequencia(id),
    enabled: !!aluno,
  });

  React.useEffect(() => {
   if (aluno?.observacoes_medicas !== undefined) {
     setObservacoesMedicas(aluno.observacoes_medicas ?? '');
   }
 }, [aluno?.observacoes_medicas]);

 const handleSalvarObservacoesMedicas = async () => {
   if (salvandoMedico) return;
   setSalvandoMedico(true);
   try {
     await alunosService.atualizar(id, { observacoes_medicas: observacoesMedicas });
     showToast.success('Resumo médico salvo com sucesso!');
   } catch (err) {
     console.error('[PerfilAluno] Erro ao salvar observações médicas:', err);
     showToast.error('Erro ao salvar. Tente novamente.');
   } finally {
     setSalvandoMedico(false);
   }
 };

  const handleRenovacaoSucesso = () => window.location.reload();

  if (loadingAluno) return <TableSkeleton />;

  let planoAtivo = planos?.find(p => p.status === 'ativo');

  if (!planoAtivo && aluno?.planos) {
    let dataFim = aluno.data_vencimento;
    let dataInicio = aluno.created_at;

    if (dataFim) {
      const dInicio = new Date(dataFim + 'T00:00:00');
      dInicio.setDate(dInicio.getDate() - 30);
      dataInicio = dInicio.toISOString().split('T')[0];
    }

    planoAtivo = {
      data_inicio: dataInicio,
      data_fim: dataFim || new Date().toISOString().split('T')[0],
      planos: aluno.planos,
    };
  }

  let textoFrequencia = '0 aulas';
  let percentualUso = 0;
  let tituloFrequencia = 'Uso do Plano';
  let subtituloFrequencia = 'Sem plano vigente encontrado';

  if (planoAtivo?.data_inicio && planoAtivo?.data_fim) {
    const inicio = new Date(planoAtivo.data_inicio + 'T00:00:00');
    const fim = new Date(planoAtivo.data_fim + 'T23:59:59');

    const diffTime = Math.abs(fim - inicio);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const totalSemanas = Math.ceil(diffDays / 7) || 1;

    let limiteSemanal = 0;
    let isLivre = false;
    const regras = planoAtivo.planos?.regras_acesso;

    if (Array.isArray(regras)) {
      regras.forEach(r => {
        const l = parseInt(r.limite);
        if (l >= 99) isLivre = true;
        else limiteSemanal += l;
      });
    }

    const aulasUsadas =
      frequencia?.filter(f => {
        const d = new Date(f.data_checkin);
        return d >= inicio && d <= fim;
      }).length || 0;

    if (isLivre) {
      textoFrequencia = `${aulasUsadas} aulas`;
      subtituloFrequencia = 'Acesso Livre / Ilimitado';
      percentualUso = 100;
    } else {
      const totalAulasNoPeriodo = limiteSemanal * totalSemanas;
      textoFrequencia = `${aulasUsadas} de ${totalAulasNoPeriodo}`;
      subtituloFrequencia = `Ciclo de ${totalSemanas} semanas • ${limiteSemanal}x por semana`;
      percentualUso =
        totalAulasNoPeriodo > 0 ? (aulasUsadas / totalAulasNoPeriodo) * 100 : 0;
    }
  }

  const abas = [
    { id: 'resumo',    label: 'Dados Gerais',    icon: <FileText size={18} /> },
    { id: 'planos',    label: 'Histórico',        icon: <CreditCard size={18} /> },
    { id: 'frequencia',label: 'Frequência',       icon: <Calendar size={18} /> },
    { id: 'anamnese',  label: 'Saúde/Anamnese',  icon: <Activity size={18} /> },
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            aria-label="Voltar"
          >
            <ArrowLeft size={24} />
          </Button>
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">
              {aluno?.nome_completo}
            </h1>
            <p className="text-muted-foreground font-medium">Gestão de Aluno</p>
          </div>
        </div>

        {/* ── BOTÃO EDITAR ── */}
        <Button
          variant="outline"
          size="md"
          leftIcon={<Edit2 size={16} />}
          onClick={() => navigate('/alunos/novo', { state: { alunoParaEditar: aluno } })}
        >
          Editar Cadastro
        </Button>
      </div>

      {/* CARDS SUPERIORES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Card de identidade */}
        <Surface variant="card" padding="lg" className="lg:col-span-2 flex items-center gap-6">
          <div className="w-24 h-24 bg-primary-soft rounded-3xl flex items-center justify-center text-primary shrink-0">
            <User size={48} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${
                  aluno?.status === 'ativo' ? 'bg-success' : 'bg-destructive'
                }`}
              />
              <span className="font-bold text-muted-foreground uppercase text-xs tracking-widest">
                {aluno?.status}
              </span>
            </div>
            <h2 className="text-xl font-bold text-foreground">
              {aluno?.planos?.nome || 'Sem plano ativo'}
            </h2>
            <p className="text-muted-foreground text-sm">
              Desde {new Date(aluno?.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </Surface>

        {/* Card de frequência */}
        <div className="bg-primary p-8 rounded-3xl text-primary-foreground relative overflow-hidden flex flex-col justify-center min-h-[140px]">
          <div className="relative z-10">
            <p className="text-primary-foreground/70 text-xs font-bold uppercase tracking-wider">
              {tituloFrequencia}
            </p>
            <h3 className="text-4xl font-black mt-1 flex items-baseline gap-2">
              {textoFrequencia.split(' ')[0]}
              <span className="text-lg font-medium text-primary-foreground/60">
                {textoFrequencia.includes(' de ')
                  ? `de ${textoFrequencia.split(' de ')[1]}`
                  : textoFrequencia.split(' ')[1]}
              </span>
            </h3>
            <p className="text-primary-foreground/60 text-xs font-medium mt-2">
              {subtituloFrequencia}
            </p>
          </div>
          {/* Barra de progresso */}
          <div className="absolute bottom-0 left-0 w-full h-2 bg-black/10">
            <div
              className="h-full bg-white/40 transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(percentualUso, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex gap-8 border-b border-border overflow-x-auto no-scrollbar">
        {abas.map(aba => (
          <button
            key={aba.id}
            onClick={() => setAbaAtiva(aba.id)}
            className={`pb-4 flex items-center gap-2 font-bold transition-all whitespace-nowrap px-1 ${
              abaAtiva === aba.id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {aba.icon} {aba.label}
          </button>
        ))}
      </div>

      <div className="pb-10">

        {/* ABA: Resumo / Dados Gerais */}
        {abaAtiva === 'resumo' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4">

            {/* Informações pessoais */}
            <Surface variant="card" padding="xl" className="space-y-8">
              <h3 className="font-black text-foreground flex items-center gap-2">
                <User size={20} className="text-primary" /> Informações Pessoais
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <LabelDado
                  titulo="Nascimento"
                  valor={
                    aluno?.data_nascimento &&
                    new Date(aluno.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR')
                  }
                />
                <LabelDado titulo="Profissão"  valor={aluno?.profissao} />
                <LabelDado titulo="CPF"         valor={aluno?.cpf} />
                <LabelDado titulo="RG"          valor={aluno?.rg} />
                <div className="col-span-2">
                  <LabelDado titulo="Contato de Emergência" valor={aluno?.contato_emergencia} />
                </div>
              </div>
            </Surface>

            {/* Contato e localização */}
            <Surface variant="card" padding="xl" className="space-y-8">
              <h3 className="font-black text-foreground flex items-center gap-2">
                <MapPin size={20} className="text-primary" /> Contato e Localização
              </h3>
              <div className="grid grid-cols-1 gap-6">
                <LabelDado titulo="E-mail"              valor={aluno?.email} />
                <LabelDado titulo="Telefone / WhatsApp" valor={aluno?.telefone} />

                <div className="p-4 bg-muted rounded-2xl border border-border">
                  <label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest block mb-2">
                    Endereço Registrado
                  </label>
                  {aluno?.endereco ? (
                    <p className="text-foreground font-bold leading-relaxed">
                      {aluno.endereco}, {aluno.numero}
                      {aluno.complemento && ` - ${aluno.complemento}`}
                      <br />
                      {aluno.bairro}, {aluno.cidade} - {aluno.estado}
                      <br />
                      <span className="text-sm font-medium text-muted-foreground">
                        CEP {aluno.cep}
                      </span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic font-medium">
                      Endereço não informado.
                    </p>
                  )}
                </div>
              </div>
            </Surface>
          </div>
        )}

        {/* ABA: Frequência */}
        {abaAtiva === 'frequencia' && (
          <Surface variant="card" padding="none" className="overflow-hidden animate-in slide-in-from-bottom-4">
            <table className="w-full text-left">
              <thead className="bg-muted/50">
                <tr>
                  <Th>Data da Aula</Th>
                  <Th>Modalidade</Th>
                  <Th className="text-right">Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {frequencia?.map(item => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-5 font-bold text-foreground">
                      {new Date(item.data_checkin).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-5 font-medium text-muted-foreground">
                      {item.agenda?.atividade}
                    </td>
                    <td className="p-5 text-right">
                      <Badge tone="success" variant="soft">
                        <CheckCircle size={12} /> Confirmada
                      </Badge>
                    </td>
                  </tr>
                ))}
                {(!frequencia || frequencia.length === 0) && (
                  <tr>
                    <td colSpan="3" className="p-8 text-center text-muted-foreground font-medium">
                      Nenhuma frequência registrada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Surface>
        )}

        {/* ABA: Planos / Histórico */}
        {abaAtiva === 'planos' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-black text-foreground text-xl">Contratos e Histórico</h3>
                <p className="text-muted-foreground text-sm">
                  Visualize ou atualize a vigência do plano deste aluno.
                </p>
              </div>
              <Button
                variant="brand"
                size="lg"
                onClick={() => setModalRenovarAberto(true)}
              >
                + Renovar / Alterar Plano
              </Button>
            </div>

            <Surface variant="card" padding="none" className="overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>Plano</Th>
                    <Th>Período</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {planos?.map(p => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-5">
                        <p className="font-bold text-foreground">{p.planos?.nome}</p>
                        <p className="text-xs font-medium text-muted-foreground">
                          R$ {p.valor_pago}
                        </p>
                      </td>
                      <td className="p-5">
                        <p className="font-bold text-foreground">
                          {new Date(p.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')} até{' '}
                          {new Date(p.data_fim + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </p>
                      </td>
                      <td className="p-5">
                        <Badge
                          tone={p.status === 'ativo' ? 'success' : 'neutral'}
                          variant="soft"
                        >
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {(!planos || planos.length === 0) && (
                    <tr>
                      <td colSpan="3" className="p-8 text-center text-muted-foreground font-medium">
                        Nenhum histórico formal de plano encontrado.
                        <br />
                        <span className="text-sm">
                          Clique no botão acima para registrar o ciclo atual.
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Surface>
          </div>
        )}

        {/* ABA: Saúde / Anamnese */}
        {abaAtiva === 'anamnese' && (
          <div className="max-w-2xl space-y-6 animate-in slide-in-from-bottom-4">

            <Surface variant="card" padding="lg" className="bg-primary-soft border-primary/20">
              <h3 className="font-black text-primary mb-2">
                Ficha Médica Externa (Forms)
              </h3>
              <p className="text-primary/80 text-sm mb-6 leading-relaxed">
                Este aluno possui um formulário de saúde preenchido no Google Forms.
                Clique abaixo para abrir as respostas detalhadas.
              </p>
              {aluno?.link_anamnese ? (
                <Button
                  as="a"
                  href={aluno.link_anamnese}
                  target="_blank"
                  rel="noreferrer"
                  variant="outline"
                  size="lg"
                  rightIcon={<ExternalLink size={18} />}
                >
                  Visualizar Ficha Completa
                </Button>
              ) : (
                <p className="text-primary/40 italic font-bold">Nenhum link vinculado.</p>
              )}
            </Surface>

            <Surface variant="card" padding="xl" className="space-y-4">
              <h3 className="font-black text-foreground flex items-center gap-2">
                <Activity size={20} className="text-destructive" />
                Observações Médicas Rápidas
              </h3>
              <Input
                as="textarea"
                rows={6}
                placeholder="Ex: Aluno possui hérnia de disco, evitar impactos..."
                value={observacoesMedicas}
                onChange={(e) => setObservacoesMedicas(e.target.value)}
                className="resize-none"
              />
              <Button variant="brand" size="lg" onClick={handleSalvarObservacoesMedicas} disabled={salvandoMedico}>
                {salvandoMedico ? 'Salvando...' : 'Salvar Resumo Médico'}
              </Button>
            </Surface>
          </div>
        )}
      </div>

      {/* MODAL */}
      <ModalRenovarPlano
        isOpen={modalRenovarAberto}
        onClose={() => setModalRenovarAberto(false)}
        alunoId={id}
        onSucesso={handleRenovacaoSucesso}
      />
    </div>
  );
}