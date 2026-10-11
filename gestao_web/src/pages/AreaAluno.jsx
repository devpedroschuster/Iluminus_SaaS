import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Camera } from 'lucide-react';
import { showToast } from '../components/shared/showToast';
import AbaAgendarAulas from '../components/aluno/AbaAgendarAulas';

export default function AreaAluno() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [abaAtiva, setAbaAtiva] = useState('schedule');
  const [modoEdicao, setModoEdicao] = useState(false);
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

  const { data: mensalidades, isLoading: loadingMensalidades } = useQuery({
    queryKey: ['minhas-mensalidades', aluno?.id],
    enabled: !!aluno?.id,
    queryFn: async () => {
      // ILU-37: limita ao histórico recente — a aba renderiza uma tabela simples
      // sem paginação, então buscar todas as mensalidades sem limite cresce
      // sem necessidade para alunos de longa data.
      const { data, error } = await supabase
        .from('mensalidades')
        .select('*')
        .eq('aluno_id', aluno.id)
        .order('data_vencimento', { ascending: false })
        .limit(100);
      if (error && error.code !== '42P01') throw error;
      return data || [];
    }
  });

  const { data: isProfessor } = useQuery({
    queryKey: ['check-hibrido', aluno?.auth_id],
    enabled: !!aluno?.auth_id,
    queryFn: async () => {
      const { data } = await supabase.from('professores').select('id').eq('auth_id', aluno.auth_id).maybeSingle();
      return !!data;
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
      showToast.success("Foto de perfil atualizada!");
    } catch (error) {
      console.error("Erro ao fazer upload da imagem:", error);
      showToast.error("Erro ao enviar a imagem. Verifique se ela é muito grande.");
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
      showToast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      console.error('[AreaAluno] handleSalvarPerfil:', error);
      showToast.error("Erro ao atualizar os dados.");
    } finally {
      setSalvandoPerfil(false);
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
  const getStatusTexto = (status, dataVencimento) => status === "pago" ? "Pago" : (dataVencimento && new Date(dataVencimento) < new Date() ? "Atrasado" : "Pendente");

  if (loadingAluno) return <div className="h-screen w-screen flex items-center justify-center bg-[#FDF8F5]"><RefreshCw className="animate-spin text-orange-600" size={48} /></div>;
  if (erroAluno || !aluno) return <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#FDF8F5]"><p className="text-gray-600 mb-4">Erro ao carregar dados do aluno.</p><button onClick={doLogout} className="btn btn-primary">Voltar para o Início</button></div>;

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
        {isProfessor && (
          <button className="nav-item" onClick={() => navigate('/agenda')} 
            style={{ marginTop: '20px', backgroundColor: '#EFF6FF', color: '#2563EB', fontWeight: 'bold' }}
          >
            <span className="nav-icon"><RefreshCw size={16} /></span> Visão Professor
          </button>
        )}
        <div className="sidebar-footer"><button className="nav-item" onClick={doLogout} style={{ color: 'var(--err)' }}><span className="nav-icon">↩</span> Sair</button></div>
      </aside>
      <div className="main-content">
        {abaAtiva === 'schedule' && (
          <div>
            <div className="main-header">
              <div><div className="main-header-title">Agendar Aulas</div><div className="main-header-sub">Escolha o dia e reserve sua vaga</div></div>
            </div>
            <div className="main-body">
              <AbaAgendarAulas onFalarComRecepcao={openWhatsApp} />
            </div>
          </div>
        )}
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
                  <div 
                    className="avatar lg relative group cursor-pointer overflow-hidden border-2 border-transparent hover:border-orange-300 transition-all"
                    onClick={() => fileInputRef.current?.click()}
                    title="Clique para alterar a foto de perfil"
                  >
                    {uploadingAvatar ? (
                      <div className="w-full h-full flex items-center justify-center bg-orange-100">
                        <RefreshCw className="animate-spin text-primary" size={24} />
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