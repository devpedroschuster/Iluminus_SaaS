import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  User, CreditCard, Calendar, Activity, 
  ArrowLeft, ExternalLink, FileText, CheckCircle, MapPin
} from 'lucide-react';
import { alunosService } from '../services/alunosService';
import { TableSkeleton } from '../components/shared/Loading';
import ModalRenovarPlano from '../components/ModalRenovarPlano';

export default function PerfilAluno() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [abaAtiva, setAbaAtiva] = useState('resumo');
  const [modalRenovarAberto, setModalRenovarAberto] = useState(false);

  // Busca de Dados
  const { data: aluno, isLoading: loadingAluno } = useQuery({
    queryKey: ['aluno', id],
    queryFn: () => alunosService.buscarPerfilCompleto(id)
  });

  const { data: planos } = useQuery({
    queryKey: ['aluno-planos', id],
    queryFn: () => alunosService.buscarHistoricoPlanos(id),
    enabled: !!aluno
  });

  const { data: frequencia } = useQuery({
    queryKey: ['aluno-frequencia', id],
    queryFn: () => alunosService.buscarHistoricoFrequencia(id),
    enabled: !!aluno
  });

  const handleRenovacaoSucesso = () => {
    window.location.reload(); 
  };

  if (loadingAluno) return <TableSkeleton />;

  // LÓGICA DE CÁLCULO DE FREQUÊNCIA
  
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
      planos: aluno.planos
    };
  }
  
  let textoFrequencia = "0 aulas";
  let percentualUso = 0;
  let tituloFrequencia = "Uso do Plano";
  let subtituloFrequencia = "Sem plano vigente encontrado";

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

    const aulasUsadas = frequencia?.filter(f => {
      const d = new Date(f.data_checkin);
      return d >= inicio && d <= fim;
    }).length || 0;

    if (isLivre) {
      textoFrequencia = `${aulasUsadas} aulas`;
      subtituloFrequencia = "Acesso Livre / Ilimitado";
      percentualUso = 100;
    } else {
      const totalAulasNoPeriodo = limiteSemanal * totalSemanas;
      textoFrequencia = `${aulasUsadas} de ${totalAulasNoPeriodo}`;
      subtituloFrequencia = `Ciclo de ${totalSemanas} semanas • ${limiteSemanal}x por semana`;
      percentualUso = totalAulasNoPeriodo > 0 ? (aulasUsadas / totalAulasNoPeriodo) * 100 : 0;
    }
  }

  const LabelDado = ({ titulo, valor }) => (
    <div className="space-y-1">
      <label className="text-[10px] uppercase font-black text-gray-400 tracking-widest block">{titulo}</label>
      <p className="font-bold text-gray-700">{valor || <span className="text-gray-300 italic font-medium">Não informado</span>}</p>
    </div>
  );

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">{aluno?.nome_completo}</h1>
          <p className="text-gray-500 font-medium">Gestão de Aluno</p>
        </div>
      </div>

      {/* CARDS SUPERIORES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-[32px] shadow-sm border border-orange-50 flex items-center gap-6">
          <div className="w-24 h-24 bg-orange-100 rounded-3xl flex items-center justify-center text-orange-600 shrink-0">
            <User size={48} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${aluno?.status === 'ativo' ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span className="font-bold text-gray-700 uppercase text-xs tracking-widest">{aluno?.status}</span>
            </div>
            <h2 className="text-xl font-bold text-gray-800">{aluno?.planos?.nome || 'Sem plano ativo'}</h2>
            <p className="text-gray-500 text-sm">Desde {new Date(aluno?.created_at).toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        {/* CARD LARANJA DINÂMICO */}
        <div className="bg-iluminus-terracota p-8 rounded-[32px] text-white relative overflow-hidden flex flex-col justify-center min-h-[140px]">
          <div className="relative z-10">
            <p className="text-orange-100 text-xs font-bold uppercase tracking-wider">{tituloFrequencia}</p>
            <h3 className="text-4xl font-black mt-1 flex items-baseline gap-2">
              {textoFrequencia.split(' ')[0]} 
              <span className="text-lg font-medium text-orange-200">
                {textoFrequencia.includes(' de ') ? `de ${textoFrequencia.split(' de ')[1]}` : textoFrequencia.split(' ')[1]}
              </span>
            </h3>
            <p className="text-orange-200 text-xs font-medium mt-2">{subtituloFrequencia}</p>
          </div>
          
          {/* BARRA DE PROGRESSO */}
          <div className="absolute bottom-0 left-0 w-full h-2 bg-black/10">
            <div 
              className="h-full bg-white/40 transition-all duration-1000 ease-out" 
              style={{ width: `${Math.min(percentualUso, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex gap-8 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {[
          { id: 'resumo', label: 'Dados Gerais', icon: <FileText size={18}/> },
          { id: 'planos', label: 'Histórico', icon: <CreditCard size={18}/> },
          { id: 'frequencia', label: 'Frequência', icon: <Calendar size={18}/> },
          { id: 'anamnese', label: 'Saúde/Anamnese', icon: <Activity size={18}/> }
        ].map(aba => (
          <button 
            key={aba.id}
            onClick={() => setAbaAtiva(aba.id)}
            className={`pb-4 flex items-center gap-2 font-bold transition-all whitespace-nowrap px-1 ${
              abaAtiva === aba.id ? 'border-b-2 border-iluminus-terracota text-iluminus-terracota' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {aba.icon} {aba.label}
          </button>
        ))}
      </div>

      {/* CONTEÚDO */}
      <div className="pb-10">
        {abaAtiva === 'resumo' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50 space-y-8">
              <h3 className="font-black text-gray-800 flex items-center gap-2"><User size={20} className="text-orange-500"/> Informações Pessoais</h3>
              <div className="grid grid-cols-2 gap-8">
                <LabelDado titulo="Nascimento" valor={aluno?.data_nascimento && new Date(aluno.data_nascimento).toLocaleDateString('pt-BR')} />
                <LabelDado titulo="Profissão" valor={aluno?.profissao} />
                <LabelDado titulo="CPF" valor={aluno?.cpf} />
                <LabelDado titulo="RG" valor={aluno?.rg} />
                <div className="col-span-2">
                  <LabelDado titulo="Contato de Emergência" valor={aluno?.contato_emergencia} />
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-50 space-y-8">
              <h3 className="font-black text-gray-800 flex items-center gap-2"><MapPin size={20} className="text-orange-500"/> Contato e Localização</h3>
              <div className="grid grid-cols-1 gap-6">
                <LabelDado titulo="E-mail" valor={aluno?.email} />
                <LabelDado titulo="Telefone / WhatsApp" valor={aluno?.telefone} />
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <label className="text-[10px] uppercase font-black text-gray-400 tracking-widest block mb-2">Endereço Registrado</label>
                  {aluno?.endereco ? (
                    <p className="text-gray-700 font-bold leading-relaxed">
                      {aluno.endereco}, {aluno.numero} {aluno.complemento && ` - ${aluno.complemento}`} <br/>
                      {aluno.bairro}, {aluno.cidade} - {aluno.estado} <br/>
                      <span className="text-sm font-medium text-gray-400">CEP {aluno.cep}</span>
                    </p>
                  ) : <p className="text-gray-300 italic font-medium">Endereço não informado.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'frequencia' && (
          <div className="bg-white rounded-[32px] shadow-sm border border-gray-50 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="p-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">Data da Aula</th>
                  <th className="p-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">Modalidade</th>
                  <th className="p-5 text-[10px] font-black uppercase text-gray-400 tracking-widest text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {frequencia?.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50/30 transition-colors">
                    <td className="p-5 font-bold text-gray-700">{new Date(item.data_checkin).toLocaleDateString('pt-BR')}</td>
                    <td className="p-5 font-medium text-gray-500">{item.agenda?.atividade}</td>
                    <td className="p-5 text-right">
                      <span className="inline-flex items-center gap-1 bg-green-50 text-green-600 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-green-100">
                        <CheckCircle size={12}/> Confirmada
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ... Aba Anamnese e Histórico (Mantenha o código anterior para elas) ... */}
        {abaAtiva === 'planos' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-black text-gray-800 text-xl">Contratos e Histórico</h3>
                <p className="text-gray-500 text-sm">Visualize ou atualize a vigência do plano deste aluno.</p>
              </div>
              <button 
                onClick={() => setModalRenovarAberto(true)} 
                className="bg-iluminus-terracota text-white px-6 py-3 rounded-2xl font-black hover:brightness-90 transition-all shadow-md active:scale-95"
              >
                + Renovar / Alterar Plano
              </button>
            </div>

            <div className="bg-white rounded-[32px] shadow-sm border border-gray-50 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50/50">
                  <tr>
                    <th className="p-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">Plano</th>
                    <th className="p-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">Período</th>
                    <th className="p-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {planos?.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50/30 transition-colors">
                      <td className="p-5">
                        <p className="font-bold text-gray-800">{p.planos?.nome}</p>
                        <p className="text-xs font-medium text-gray-400">R$ {p.valor_pago}</p>
                      </td>
                      <td className="p-5">
                        <p className="font-bold text-gray-700">
                          {new Date(p.data_inicio).toLocaleDateString('pt-BR')} até {new Date(p.data_fim).toLocaleDateString('pt-BR')}
                        </p>
                      </td>
                      <td className="p-5">
                        <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase border ${p.status === 'ativo' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!planos || planos.length === 0) && (
                    <tr>
                      <td colSpan="3" className="p-8 text-center text-gray-400 font-medium">
                        Nenhum histórico formal de plano encontrado.<br/>
                        <span className="text-sm">Clique no botão acima para registrar o ciclo atual.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {abaAtiva === 'anamnese' && (
          <div className="max-w-2xl space-y-6 animate-in slide-in-from-bottom-4">
            <div className="bg-orange-50 p-6 rounded-[32px] border border-orange-100">
              <h3 className="font-black text-orange-800 mb-2">Ficha Médica Externa (Forms)</h3>
              <p className="text-orange-700 text-sm mb-6 leading-relaxed">
                Este aluno possui um formulário de saúde preenchido no Google Forms. Clique abaixo para abrir as respostas detalhadas.
              </p>
              {aluno?.link_anamnese ? (
                <a href={aluno.link_anamnese} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-white text-orange-600 px-8 py-4 rounded-2xl font-black shadow-sm hover:shadow-md transition-all active:scale-95">
                  Visualizar Ficha Completa <ExternalLink size={18}/>
                </a>
              ) : <p className="text-orange-300 italic font-bold">Nenhum link vinculado.</p>}
            </div>

            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
              <h3 className="font-black text-gray-800 mb-4 flex items-center gap-2"><Activity size={20} className="text-red-500"/> Observações Médicas Rápidas</h3>
              <textarea 
                className="w-full h-44 p-5 bg-gray-50 border border-gray-100 rounded-3xl focus:ring-2 focus:ring-orange-500 outline-none font-medium text-gray-700 transition-all"
                placeholder="Ex: Aluno possui hérnia de disco, evitar impactos..."
                defaultValue={aluno?.observacoes_medicas}
              />
              <button className="mt-4 bg-iluminus-terracota text-white px-8 py-4 rounded-2xl font-black hover:brightness-90 transition-all active:scale-95 shadow-lg shadow-orange-900/10">
                Salvar Resumo Médico
              </button>
            </div>
          </div>
        )}
      </div>
      <ModalRenovarPlano 
        isOpen={modalRenovarAberto} 
        onClose={() => setModalRenovarAberto(false)} 
        alunoId={id}
        onSucesso={handleRenovacaoSucesso}
      />
    </div>
  );
}