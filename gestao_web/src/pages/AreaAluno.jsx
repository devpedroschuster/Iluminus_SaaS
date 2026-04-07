import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, AlertCircle, Camera } from 'lucide-react';

const gerarProximosDias = () => {
  const dias = [];
  const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const diasBanco = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    const dataLocal = `${ano}-${mes}-${dia}`;

    dias.push({
      dataIso: dataLocal, 
      diaSemana: i === 0 ? 'Hoje' : nomesDias[d.getDay()],
      diaMes: `${dia}/${mes}`,
      diaBanco: diasBanco[d.getDay()]
    });
  }
  return dias;
};

const PROXIMOS_DIAS = gerarProximosDias();

export default function AreaAluno() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  
  const [abaAtiva, setAbaAtiva] = useState('schedule'); 
  const [diaAtivo, setDiaAtivo] = useState(PROXIMOS_DIAS[0].dataIso); 
  const [modoEdicao, setModoEdicao] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);
  
  const [formEdit, setFormEdit] = useState({ telefone: '', cpf: '', data_nascimento: '' });
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const { data: aluno, isLoading: loadingAluno, isError: erroAluno } = useQuery({
    queryKey: ['meu-perfil'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não logado");

      const { data, error } = await supabase
        .from('alunos')
        .select(`*, planos (nome, preco, regras_acesso)`)
        .eq('auth_id', session.user.id)
        .single();

      if (error) throw error;
      return data;
    }
  });

  const { data: presencasMes } = useQuery({
    queryKey: ['presencas-mes', aluno?.id],
    enabled: !!aluno?.id,
    queryFn: async () => {
      const hoje = new Date();
      const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();
      
      const { data, error } = await supabase
        .from('presencas')
        .select(`id, agenda(atividade, espaco)`)
        .eq('aluno_id', aluno.id)
        .gte('data_checkin', primeiroDia);

      if (error) throw error;
      return data || [];
    }
  }); 

  const { data: mensalidades, isLoading: loadingMensalidades } = useQuery({
    queryKey: ['minhas-mensalidades', aluno?.id],
    enabled: !!aluno?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mensalidades')
        .select('*')
        .eq('aluno_id', aluno.id)
        .order('data_vencimento', { ascending: false });

      if (error && error.code !== '42P01') throw error;
      return data || [];
    }
  });

  const { data: aulasDoDia, isLoading: loadingAulas } = useQuery({
    queryKey: ['agenda', diaAtivo],
    enabled: !!aluno?.id,
    queryFn: async () => {
      const diaSelecionado = PROXIMOS_DIAS.find(d => d.dataIso === diaAtivo);
      const diaCurto = diaSelecionado.diaBanco.split('-')[0]; 

      const { data, error } = await supabase
        .from('agenda')
        .select(`*, professores (nome), presencas (aluno_id)`)
        .or(`dia_semana.ilike.*${diaCurto}*,data_especifica.eq.${diaSelecionado.dataIso}`)
        .order('horario', { ascending: true });

      if (error) throw error;
      return data || [];
    }
  });

  const handleAvatarUpload = async (event) => {
    try {
      setUploadingAvatar(true);
      const file = event.target.files[0];
      if (!file) return;

      const fileExt = file.name.split('.').pop();
      const fileName = `${aluno.id}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('alunos')
        .update({ avatar_url: publicUrl })
        .eq('id', aluno.id);

      if (updateError) throw updateError;

      await queryClient.invalidateQueries(['meu-perfil']);
      
    } catch (error) {
      console.error("Erro ao fazer upload da imagem:", error);
      alert("Erro ao enviar a imagem. Verifique se ela é muito grande e tente novamente.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const iniciarEdicao = () => {
    setFormEdit({ telefone: aluno.telefone || '', cpf: aluno.cpf || '', data_nascimento: aluno.data_nascimento || '' });
    setModoEdicao(true);
  };

  const handleSalvarPerfil = async () => {
    setSalvandoPerfil(true);
    try {
      const { error } = await supabase.from('alunos').update(formEdit).eq('id', aluno.id);
      if (error) throw error;
      await queryClient.invalidateQueries(['meu-perfil']);
      setModoEdicao(false);
    } catch (error) {
      alert("Erro ao atualizar os dados.");
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const handleAgendar = async (agendaId) => {
    setProcessandoId(agendaId);
    try {
      const { error } = await supabase.rpc('agendar_aula', { p_aluno_id: aluno.id, p_agenda_id: agendaId });
      if (error) throw error;
      await queryClient.invalidateQueries(['agenda', diaAtivo]);
      await queryClient.invalidateQueries(['presencas-mes']);
    } catch (error) {
      alert(`Ops! O banco de dados recusou: ${error.message || error.details || 'Erro desconhecido'}`);
    } finally {
      setProcessandoId(null);
    }
  };

  const handleCancelar = async (agendaId) => {
    setProcessandoId(agendaId);
    try {
      const { error } = await supabase.rpc('cancelar_agendamento', { p_aluno_id: aluno.id, p_agenda_id: agendaId });
      if (error) throw error;
      await queryClient.invalidateQueries(['agenda', diaAtivo]);
      await queryClient.invalidateQueries(['presencas-mes']);
    } catch (error) {
      alert("Erro ao cancelar o agendamento.");
    } finally {
      setProcessandoId(null);
    }
  };

  const doLogout = async () => { await supabase.auth.signOut(); navigate('/'); };
  const openWhatsApp = (msg) => window.open(`https://wa.me/5551994424348?text=${encodeURIComponent(msg)}`, '_blank');
  
  const getInitials = (name) => {
    if (!name) return 'A';
    const parts = name.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  };

  const formatarData = (dataStr) => {
    if (!dataStr) return "--/--/----";
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  };

  const formatarMoeda = (valor) => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const formatarHorario = (horaStr) => horaStr ? horaStr.substring(0, 5) : "--:--";
  const getStatusTexto = (status, dataVencimento) => status === "pago" ? "Pago" : (dataVencimento && new Date(dataVencimento) < new Date() ? "Atrasado" : "Pendente");

  if (loadingAluno) return <div className="h-screen w-screen flex items-center justify-center bg-[#FDF8F5]"><RefreshCw className="animate-spin text-orange-600" size={48} /></div>;
  if (erroAluno || !aluno) return <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#FDF8F5]"><p className="text-gray-600 mb-4">Erro ao carregar dados do aluno.</p><button onClick={doLogout} className="btn btn-primary">Voltar para o Início</button></div>;

  const regrasPlano = aluno.planos?.regras_acesso || [];
  let aulasPermitidas = [];
  if (aulasDoDia) {
    aulasPermitidas = aulasDoDia.filter(aula => {
      const jaAgendado = aula.presencas?.some(p => p.aluno_id === aluno.id);
      if (jaAgendado) return true; 
      if (!aluno.planos || regrasPlano.length === 0) return false;

      const atividadeLower = (aula.atividade || '').toLowerCase();
      const espacoLower = (aula.espaco || '').toLowerCase();

      return regrasPlano.some(r => {
         const modLower = r.modalidade.toLowerCase();
         return modLower === 'livre/todos' || modLower === atividadeLower || modLower === espacoLower;
      });
    });
  }

  return (
    <div id="page-dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo"><div className="logo-mark">I</div><span className="logo-name">ILUMINUS</span></div>
        <div className="user-card">
          <div className="avatar overflow-hidden">
            {aluno.avatar_url ? (
              <img src={aluno.avatar_url} alt="Perfil" className="w-full h-full object-cover" />
            ) : (
              getInitials(aluno.nome_completo)
            )}
          </div>
          <div>
            <div className="user-card-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{aluno.nome_completo}</div>
            <div className="user-card-plan">{aluno.planos ? aluno.planos.nome : 'Sem plano ativo'}</div>
          </div>
        </div>
        <div className="nav-section">Menu</div>
        <button className={`nav-item ${abaAtiva === 'schedule' ? 'active' : ''}`} onClick={() => setAbaAtiva('schedule')}><span className="nav-icon">📅</span> Agendar Aulas</button>
        <button className={`nav-item ${abaAtiva === 'profile' ? 'active' : ''}`} onClick={() => setAbaAtiva('profile')}><span className="nav-icon">👤</span> Meu Perfil</button>
        <button className={`nav-item ${abaAtiva === 'payments' ? 'active' : ''}`} onClick={() => setAbaAtiva('payments')}><span className="nav-icon">💳</span> Mensalidades</button>
        <div className="sidebar-footer"><button className="nav-item" onClick={doLogout} style={{ color: 'var(--err)' }}><span className="nav-icon">↩</span> Sair</button></div>
      </aside>

      <div className="main-content">
        
        {abaAtiva === 'schedule' && (
          <div>
            <div className="main-header">
              <div><div className="main-header-title">Agendar Aulas</div><div className="main-header-sub">Escolha o dia e reserve sua vaga</div></div>
            </div>
            <div className="main-body">

              {aluno.planos && regrasPlano.length > 0 && (
                <div className="mb-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <p className="text-[11px] font-extrabold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-orange-400"></span>
                    Consumo do Plano: {aluno.planos.nome}
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {regrasPlano.map((regra, idx) => {
                       const usosDaRegra = presencasMes?.filter(p => {
                          const modLower = regra.modalidade.toLowerCase();
                          if (modLower === 'livre/todos') return true;
                          const pAtiv = p.agenda?.atividade?.toLowerCase() || '';
                          const pEspaco = p.agenda?.espaco?.toLowerCase() || '';
                          return modLower === pAtiv || modLower === pEspaco;
                       }).length || 0;

                       const limit = regra.limite;
                       const pct = limit === 999 ? 0 : Math.min((usosDaRegra / limit) * 100, 100);

                       return (
                         <div key={idx} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                            <div className="flex justify-between items-end mb-2">
                              <div>
                                <p className="font-bold text-gray-700 text-sm">{regra.modalidade}</p>
                                <p className="text-xs text-gray-400 font-medium mt-0.5">
                                  Usado: <span className="text-iluminus-terracota font-bold text-sm">{usosDaRegra}</span> / {limit === 999 ? 'Ilimitado' : limit}
                                </p>
                              </div>
                              {limit !== 999 && <span className="text-[10px] font-bold text-gray-400">{Math.floor(pct)}%</span>}
                            </div>
                            {limit !== 999 && (
                              <div className="bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? 'var(--err)' : 'var(--pri)' }}></div>
                              </div>
                            )}
                         </div>
                       )
                    })}
                  </div>
                </div>
              )}

              <div className="day-tabs">
                {PROXIMOS_DIAS.map(d => (
                  <button key={d.dataIso} className={`day-tab ${diaAtivo === d.dataIso ? 'active' : ''}`} onClick={() => setDiaAtivo(d.dataIso)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '8px 16px' }}>
                    <span style={{ fontSize: '13px' }}>{d.diaSemana}</span>
                    <span style={{ fontSize: '10px', opacity: 0.8 }}>{d.diaMes}</span>
                  </button>
                ))}
              </div>

              <div id="class-list">
                {loadingAulas ? (
                   <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-gray-400" /></div>
                ) : !aluno.planos ? (
                   <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
                     <AlertCircle className="mx-auto text-gray-300 mb-3" size={40} />
                     <p className="text-gray-800 font-bold text-lg mb-1">Sem plano ativo</p>
                     <p className="text-gray-500 text-sm">Você precisa ter um plano para visualizar e agendar aulas.</p>
                   </div>
                ) : aulasPermitidas.length === 0 ? (
                  <div className="text-center py-14 bg-white rounded-3xl border border-gray-100 shadow-sm">
                    <p className="text-gray-500 font-medium">Nenhuma aula disponível para o seu plano neste dia.</p>
                  </div>
                ) : (
                  aulasPermitidas.map(aula => {
                    const jaAgendado = aula.presencas?.some(p => p.aluno_id === aluno.id);
                    const vagasRestantes = aula.capacidade - (aula.vagas_ocupadas || 0);
                    const lotado = vagasRestantes <= 0;
                    const estaProcessando = processandoId === aula.id;

                    let regraDestaAula = null;
                    let usosDestaAula = 0;
                    const atividadeLower = (aula.atividade || '').toLowerCase();
                    const espacoLower = (aula.espaco || '').toLowerCase();

                    for (const r of regrasPlano) {
                       const modLower = r.modalidade.toLowerCase();
                       if (modLower === 'livre/todos' || modLower === atividadeLower || modLower === espacoLower) {
                          regraDestaAula = r;
                          break;
                       }
                    }

                    if (regraDestaAula) {
                       usosDestaAula = presencasMes?.filter(p => {
                          const modLower = regraDestaAula.modalidade.toLowerCase();
                          if (modLower === 'livre/todos') return true;
                          const pAtiv = p.agenda?.atividade?.toLowerCase() || '';
                          const pEspaco = p.agenda?.espaco?.toLowerCase() || '';
                          return modLower === pAtiv || modLower === pEspaco;
                       }).length || 0;
                    }

                    const limiteAtingido = regraDestaAula && regraDestaAula.limite !== 999 && usosDestaAula >= regraDestaAula.limite;

                    return (
                      <div key={aula.id} className={`class-card anim-fade-up ${jaAgendado ? 'booked' : ''}`}>
                        <div className="class-time-block">
                          <div className="class-time">{formatarHorario(aula.horario)}</div>
                          <div className={`class-space ${aula.espaco === 'danca' ? 'danca' : 'funcional'}`}>
                            {aula.espaco === 'danca' ? 'Dança' : 'Funcional'}
                          </div>
                        </div>
                        
                        <div className="class-info">
                          <div className="class-name">{aula.atividade}</div>
                          <div className="class-teacher">Prof. {aula.professores?.nome?.split(' ')[0] || 'A definir'}</div>
                          
                          <div className="capacity-bar-row">
                            <span className={`capacity-label ${lotado && !jaAgendado ? 'last-spot' : ''}`}>
                              {aula.vagas_ocupadas || 0}/{aula.capacidade} vagas ocupadas
                            </span>
                            <div className="capacity-bar-track">
                              <div className="capacity-bar-fill" style={{ width: `${((aula.vagas_ocupadas || 0) / aula.capacidade) * 100}%`, background: jaAgendado ? 'var(--ok)' : (lotado ? 'var(--err)' : 'var(--pri)') }}></div>
                            </div>
                          </div>
                        </div>

                        <div className="class-action" style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          {jaAgendado ? (
                            <>
                              <button onClick={() => handleCancelar(aula.id)} disabled={estaProcessando} className="btn-book cancel">
                                {estaProcessando ? <RefreshCw className="animate-spin" size={16} /> : 'Cancelar'}
                              </button>
                              <div className="booked-check flex items-center gap-1 mt-2 text-green-600"><CheckCircle2 size={14} /> Agendado</div>
                            </>
                          ) : limiteAtingido ? (
                            <div className="text-[11px] font-bold text-red-400 text-center uppercase tracking-wider flex flex-col items-center gap-1">
                              <AlertCircle size={16}/> Limite Atingido
                            </div>
                          ) : (
                            <button onClick={() => handleAgendar(aula.id)} disabled={lotado || estaProcessando} className={`btn-book ${lotado ? 'disabled' : 'reserve'}`}>
                              {estaProcessando ? <RefreshCw className="animate-spin text-white" size={16} /> : (lotado ? 'Esgotado' : 'Agendar')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ABA PERFIL */}
        {abaAtiva === 'profile' && (
          <div>
            <div className="main-header">
              <div>
                <div className="main-header-title">Meu Perfil</div>
                <div className="main-header-sub">Seus dados pessoais e plano</div>
              </div>
              {modoEdicao ? (
                <div className="flex items-center gap-3">
                  <button className="btn btn-ghost btn-sm" onClick={() => setModoEdicao(false)}>Cancelar</button>
                  <button className="btn btn-primary btn-sm" onClick={handleSalvarPerfil} disabled={salvandoPerfil}>
                    {salvandoPerfil ? <RefreshCw className="animate-spin" size={16} /> : 'Salvar Alterações'}
                  </button>
                </div>
              ) : (
                <button className="btn btn-outline btn-sm" onClick={iniciarEdicao}>Editar Perfil</button>
              )}
            </div>
            <div className="main-body">
              <div className="profile-top">
                <div className="profile-id-card card">
                  
                  {/* FOTO DE PERFIL */}
                  <div 
                    className="avatar lg relative group cursor-pointer overflow-hidden border-2 border-transparent hover:border-orange-300 transition-all"
                    onClick={() => fileInputRef.current?.click()}
                    title="Clique para alterar a foto de perfil"
                  >
                    {uploadingAvatar ? (
                      <div className="w-full h-full flex items-center justify-center bg-orange-100">
                        <RefreshCw className="animate-spin text-iluminus-terracota" size={24} />
                      </div>
                    ) : aluno.avatar_url ? (
                      <img src={aluno.avatar_url} alt="Perfil" className="w-full h-full object-cover" />
                    ) : (
                      getInitials(aluno.nome_completo)
                    )}
                    
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera size={24} className="text-white" />
                    </div>
                  </div>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />

                  <div>
                    <div className="profile-name">{aluno.nome_completo}</div>
                    <div className="profile-since">Aluno Iluminus</div>
                  </div>
                </div>
                
                <div className="profile-plan-card card">
                  <div className="profile-plan-label">Plano Ativo</div>
                  <div className="profile-plan-name">{aluno.planos ? aluno.planos.nome : 'Nenhum'}</div>
                  <div className="profile-plan-desc">{aluno.planos ? `Valor: ${formatarMoeda(aluno.planos.preco)}` : 'Você ainda não possui um plano vinculado.'}</div>
                </div>
              </div>
              <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--muted)', marginBottom: '24px' }}>Dados Pessoais</div>
                <div className="data-grid">
                  <div className="data-field"><label>E-mail (Acesso)</label><div className="data-value opacity-60 cursor-not-allowed">{aluno.email}</div></div>
                  <div className="data-field">
                    <label>Telefone</label>
                    {modoEdicao ? <input className="inp py-2 mt-1" value={formEdit.telefone} onChange={e => setFormEdit({...formEdit, telefone: e.target.value})} placeholder="(00) 00000-0000" /> : <div className="data-value">{aluno.telefone || 'Não informado'}</div>}
                  </div>
                  <div className="data-field">
                    <label>CPF</label>
                    {modoEdicao ? <input className="inp py-2 mt-1" value={formEdit.cpf} onChange={e => setFormEdit({...formEdit, cpf: e.target.value})} placeholder="000.000.000-00" /> : <div className="data-value">{aluno.cpf || 'Não informado'}</div>}
                  </div>
                  <div className="data-field">
                    <label>Data de Nascimento</label>
                    {modoEdicao ? <input className="inp py-2 mt-1" type="date" value={formEdit.data_nascimento} onChange={e => setFormEdit({...formEdit, data_nascimento: e.target.value})} /> : <div className="data-value">{formatarData(aluno.data_nascimento) || 'Não informado'}</div>}
                  </div>
                </div>
              </div>
              <div className="wa-btn-row">
                <button className="btn btn-wa btn-full" onClick={() => openWhatsApp(`Olá, Espaço Iluminus! Sou o aluno(a) ${aluno.nome_completo} e preciso de ajuda.`)} style={{ padding: '15px', fontSize: '15px' }}>💬 Suporte via WhatsApp</button>
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'payments' && (
          <div>
            <div className="main-header">
              <div><div className="main-header-title">Mensalidades</div><div className="main-header-sub">Histórico e status dos seus pagamentos</div></div>
            </div>
            <div className="main-body">
              <div className="card">
                <div className="pay-table-wrapper">
                  {loadingMensalidades ? (
                    <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-gray-400" /></div>
                  ) : !mensalidades || mensalidades.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">Nenhuma cobrança registrada.</p>
                  ) : (
                    <table className="pay-table">
                      <thead><tr><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead>
                      <tbody>
                        {mensalidades.map(m => {
                          const statusTxt = getStatusTexto(m.status, m.data_vencimento);
                          let badgeClass = "badge-warn";
                          if (statusTxt === "Pago") badgeClass = "badge-ok";
                          if (statusTxt === "Atrasado") badgeClass = "badge-err";
                          return (
                            <tr key={m.id}>
                              <td style={{ fontWeight: 600 }}>{formatarData(m.data_vencimento)}</td>
                              <td style={{ fontWeight: 700 }}>{formatarMoeda(m.valor_pago || m.valor_esperado)}</td>
                              <td><span className={`badge ${badgeClass}`}>{statusTxt}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}