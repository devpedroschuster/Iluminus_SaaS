import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Camera, CalendarDays, User, CreditCard, LogOut, Calendar } from 'lucide-react';
import { showToast } from '../components/shared/showToast';
import AbaAgendarAulas from '../components/aluno/AbaAgendarAulas';
import { PWABanners } from '../components/PWABanners';
import { statusMensalidadeAluno, hojeBrasilia, formatarCPF, formatarTelefone } from '../lib/utils';
import {
  montarAtualizacaoPerfil, validarArquivoAvatar, caminhoAvatar, caminhoDoAvatarSalvo, AVATAR_TIPOS,
} from '../lib/perfilAluno';
import { planosValidos, rotuloPlanoAluno } from '../lib/planosAluno';
import { areaAlunoService } from '../services/areaAlunoService';
import { useAuth } from '../hooks/useAuth';

// Abas da barra inferior do celular (ILU-81). No computador a sidebar faz esse papel.
const ABAS_CELULAR = [
  { id: 'schedule', rotulo: 'Agendar', icone: <CalendarDays size={22} aria-hidden="true" /> },
  { id: 'profile', rotulo: 'Perfil', icone: <User size={22} aria-hidden="true" /> },
  { id: 'payments', rotulo: 'Mensalidades', icone: <CreditCard size={22} aria-hidden="true" /> },
];

export default function AreaAluno() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  // ILU-83: o professor que também é aluno chega aqui pelo menu dele e volta
  // para a Área do Professor por este botão.
  const { perfil, sessao } = useAuth();
  const ehProfessor = perfil === 'professor';
  const authId = sessao?.user?.id ?? null;
  const [abaAtiva, setAbaAtiva] = useState('schedule');
  const [modoEdicao, setModoEdicao] = useState(false);
  const [formEdit, setFormEdit] = useState({ telefone: '', cpf: '', data_nascimento: '' });
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // ILU-84: a chave leva o login, e o AuthProvider limpa o cache ao sair ou
  // trocar de usuário — num aparelho compartilhado, o próximo login não vê os
  // dados do aluno anterior.
  const chavePerfil = ['meu-perfil', authId];
  const { data: aluno, isLoading: loadingAluno, isError: erroAluno } = useQuery({
    queryKey: chavePerfil,
    enabled: !!authId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alunos')
        .select('*')
        .eq('auth_id', authId)
        .single();
      if (error) throw error;
      return data;
    }
  });

  // ILU-127: o aluno pode ter vários planos; o RLS deixa ler os próprios.
  const { data: planosAluno, isLoading: loadingPlanos, isError: erroPlanos } = useQuery({
    queryKey: ['meus-planos', aluno?.id],
    enabled: !!aluno?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('planos_aluno')
        .select('id, data_inicio, data_fim, pausado_desde, encerrado_em, encerramento_efetivado, created_at, planos (nome, preco)')
        .eq('aluno_id', aluno.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: mensalidades, isLoading: loadingMensalidades } = useQuery({
    queryKey: ['minhas-mensalidades', aluno?.id],
    enabled: !!aluno?.id,
    queryFn: () => areaAlunoService.listarMensalidades(aluno.id),
  });

  // ILU-85/ILU-44: a foto vai para a pasta do próprio login (`<auth_id>/...`,
  // a única em que as policies do bucket deixam gravar), com tipo e tamanho
  // conferidos antes do envio; a foto anterior é apagada depois de trocada.
  const handleAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const erroArquivo = validarArquivoAvatar(file);
    if (erroArquivo) {
      showToast.error(erroArquivo);
      return;
    }

    setUploadingAvatar(true);
    try {
      const caminho = caminhoAvatar(authId, file);
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(caminho, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(caminho);
      const { error: updateError } = await supabase
        .from('alunos')
        .update({ avatar_url: publicUrl })
        .eq('id', aluno.id);
      if (updateError) {
        await supabase.storage.from('avatars').remove([caminho]);
        throw updateError;
      }
      const anterior = caminhoDoAvatarSalvo(aluno.avatar_url, authId);
      if (anterior) {
        const { error: removerError } = await supabase.storage.from('avatars').remove([anterior]);
        if (removerError) console.warn('[AreaAluno] foto anterior não removida:', removerError.message);
      }
      await queryClient.invalidateQueries({ queryKey: chavePerfil });
      showToast.success("Foto de perfil atualizada!");
    } catch (error) {
      console.error("Erro ao fazer upload da imagem:", error);
      showToast.error("Não foi possível enviar a foto. Tente novamente.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const iniciarEdicao = () => {
    setFormEdit({
      telefone: formatarTelefone(aluno.telefone),
      cpf: formatarCPF(aluno.cpf),
      data_nascimento: aluno.data_nascimento || '',
    });
    setModoEdicao(true);
  };

  // ILU-84: campos vazios vão como null (a data vazia era recusada pelo banco)
  // e telefone/CPF são conferidos antes de salvar.
  const handleSalvarPerfil = async () => {
    const { dados, erro } = montarAtualizacaoPerfil(formEdit, hojeBrasilia());
    if (erro) {
      showToast.error(erro);
      return;
    }
    setSalvandoPerfil(true);
    try {
      const { error } = await supabase.from('alunos').update(dados).eq('id', aluno.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: chavePerfil });
      setModoEdicao(false);
      showToast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      console.error('[AreaAluno] handleSalvarPerfil:', error);
      showToast.error("Erro ao atualizar os dados.");
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const doLogout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    navigate('/');
  };
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
  const formatarDataCurta = (dataStr) => {
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano.slice(-2)}`;
  };
  const formatarMoeda = (valor) => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Planos válidos do aluno. Enquanto a lista carrega (ou se falhar) não afirmamos "sem plano".
  const meusPlanos = planosAluno ? planosValidos(planosAluno, hojeBrasilia()) : [];
  const planoPrincipal = meusPlanos[0]?.planos ?? null;
  const nomePlanoCabecalho = planoPrincipal
    ? `${planoPrincipal.nome}${meusPlanos.length > 1 ? ` +${meusPlanos.length - 1}` : ''}`
    : loadingPlanos ? '…' : erroPlanos ? 'Planos indisponíveis' : 'Sem plano ativo';

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
            <div className="user-card-plan">{nomePlanoCabecalho}</div>
          </div>
        </div>
        <div className="nav-section">Menu</div>
        <button className={`nav-item ${abaAtiva === 'schedule' ? 'active' : ''}`} onClick={() => setAbaAtiva('schedule')}><span className="nav-icon">📅</span> Agendar Aulas</button>
        <button className={`nav-item ${abaAtiva === 'profile' ? 'active' : ''}`} onClick={() => setAbaAtiva('profile')}><span className="nav-icon">👤</span> Meu Perfil</button>
        <button className={`nav-item ${abaAtiva === 'payments' ? 'active' : ''}`} onClick={() => setAbaAtiva('payments')}><span className="nav-icon">💳</span> Mensalidades</button>
        {ehProfessor && (
          <button className="nav-item" onClick={() => navigate('/agenda')} style={{ marginTop: '20px', fontWeight: 'bold' }}>
            <span className="nav-icon"><Calendar size={16} aria-hidden="true" /></span> Área do Professor
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
                  <input type="file" ref={fileInputRef} className="hidden" accept={Object.keys(AVATAR_TIPOS).join(',')} onChange={handleAvatarUpload} />
                  <div>
                    <div className="profile-name">{aluno.nome_completo}</div>
                    <div className="profile-since">Aluno Iluminus</div>
                  </div>
                </div>
                {meusPlanos.length > 1 ? meusPlanos.map((pa) => (
                  <div key={pa.id} className="profile-plan-card card">
                    <div className="profile-plan-label">{pa.pausado_desde ? 'Plano Pausado' : 'Plano Ativo'}</div>
                    <div className="profile-plan-name">{rotuloPlanoAluno(pa, meusPlanos)}</div>
                    <div className="profile-plan-desc">
                      {pa.pausado_desde
                        ? `Pausado desde ${formatarData(pa.pausado_desde)}. Para voltar às aulas, fale com a recepção.`
                        : pa.data_fim ? `${pa.data_fim < hojeBrasilia() ? 'Venceu' : 'Vence'} em ${formatarDataCurta(pa.data_fim)}` : 'Sem data de vencimento'}
                    </div>
                  </div>
                )) : meusPlanos.length === 1 ? (
                  <div className="profile-plan-card card">
                    <div className="profile-plan-label">{meusPlanos[0].pausado_desde ? 'Plano Pausado' : 'Plano Ativo'}</div>
                    <div className="profile-plan-name">{meusPlanos[0].planos?.nome ?? 'Nenhum'}</div>
                    <div className="profile-plan-desc">
                      {meusPlanos[0].pausado_desde
                        ? `Pausado desde ${formatarData(meusPlanos[0].pausado_desde)}. Para voltar às aulas, fale com a recepção.`
                        : meusPlanos[0].planos ? `Valor: ${formatarMoeda(meusPlanos[0].planos.preco)}` : 'Você ainda não possui um plano vinculado.'}
                    </div>
                  </div>
                ) : (
                  <div className="profile-plan-card card">
                    <div className="profile-plan-label">Plano Ativo</div>
                    <div className="profile-plan-name">{loadingPlanos ? '…' : erroPlanos ? '—' : 'Nenhum'}</div>
                    <div className="profile-plan-desc">{loadingPlanos ? '' : erroPlanos ? 'Não foi possível carregar seus planos.' : 'Você ainda não possui um plano vinculado.'}</div>
                  </div>
                )}
              </div>
              <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--muted)', marginBottom: '24px' }}>Dados Pessoais</div>
                <div className="data-grid">
                  {/* ILU-84: o e-mail do login, que pode diferir do cadastro (ILU-90). */}
                  <div className="data-field"><label>E-mail (Acesso)</label><div className="data-value opacity-60 cursor-not-allowed">{sessao?.user?.email || aluno.email}</div></div>
                  <div className="data-field">
                    <label>Telefone</label>
                    {modoEdicao ? <input className="inp py-2 mt-1" type="tel" inputMode="numeric" value={formEdit.telefone} onChange={e => setFormEdit({...formEdit, telefone: formatarTelefone(e.target.value.replace(/\D/g, '').slice(0, 11))})} placeholder="(00) 00000-0000" /> : <div className="data-value">{aluno.telefone ? formatarTelefone(aluno.telefone) : 'Não informado'}</div>}
                  </div>
                  <div className="data-field">
                    <label>CPF</label>
                    {modoEdicao ? <input className="inp py-2 mt-1" inputMode="numeric" value={formEdit.cpf} onChange={e => setFormEdit({...formEdit, cpf: formatarCPF(e.target.value.replace(/\D/g, '').slice(0, 11))})} placeholder="000.000.000-00" /> : <div className="data-value">{aluno.cpf ? formatarCPF(aluno.cpf) : 'Não informado'}</div>}
                  </div>
                  <div className="data-field">
                    <label>Data de Nascimento</label>
                    {modoEdicao ? <input className="inp py-2 mt-1" type="date" max={hojeBrasilia()} value={formEdit.data_nascimento} onChange={e => setFormEdit({...formEdit, data_nascimento: e.target.value})} /> : <div className="data-value">{aluno.data_nascimento ? formatarData(aluno.data_nascimento) : 'Não informado'}</div>}
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
                          const statusTxt = statusMensalidadeAluno(m.status, m.data_vencimento);
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
      <nav className="bottom-nav" aria-label="Menu da Área do Aluno">
        {ABAS_CELULAR.map(({ id, rotulo, icone }) => (
          <button
            key={id}
            type="button"
            className={`bottom-nav-item ${abaAtiva === id ? 'active' : ''}`}
            aria-current={abaAtiva === id ? 'page' : undefined}
            onClick={() => setAbaAtiva(id)}
          >
            <span className="bottom-nav-icon">{icone}</span>
            {rotulo}
          </button>
        ))}
        {ehProfessor && (
          <button type="button" className="bottom-nav-item" onClick={() => navigate('/agenda')}>
            <span className="bottom-nav-icon"><Calendar size={22} aria-hidden="true" /></span>
            Professor
          </button>
        )}
        <button type="button" className="bottom-nav-item sair" onClick={doLogout}>
          <span className="bottom-nav-icon"><LogOut size={22} aria-hidden="true" /></span>
          Sair
        </button>
      </nav>
      <PWABanners oferecerInstalacao tema="claro" />
    </div>
  );
}