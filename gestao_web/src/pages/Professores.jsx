import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Edit2, ShieldAlert, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Serviços
import { professoresService } from '../services/professoresService';
import { useDebounce } from '../hooks/useDebounce';

// Componentes compartilhados (legado — Toast e ModalConfirmacao)
import { showToast } from '../components/shared/Toast';

// DS — componentes novos
import Modal, { useModal } from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Input, { Label } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Surface from '../components/ui/Surface';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

export default function Professores() {
  const [professores, setProfessores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  const [formProfessor, setFormProfessor] = useState({
    id: null, nome: '', email: '', telefone: '', pix_comissao: '', auth_id: null,
  });
  const [profSelecionado, setProfSelecionado] = useState(null);
  const [saving, setSaving] = useState(false);

  const buscaDebounced = useDebounce(busca, 400);
  const modalForm   = useModal();
  const modalStatus = useModal();

  useEffect(() => {
    carregarProfessores();
  }, [buscaDebounced]);

  async function carregarProfessores() {
    setLoading(true);
    try {
      const data = await professoresService.listar(buscaDebounced);
      setProfessores(data);
    } catch {
      showToast.error('Erro ao carregar lista.');
    } finally {
      setLoading(false);
    }
  }

  function abrirModalCriar() {
    setFormProfessor({ id: null, nome: '', email: '', telefone: '', pix_comissao: '', auth_id: null });
    modalForm.abrir();
  }

  function abrirModalEditar(prof) {
    setFormProfessor({
      id: prof.id,
      nome: prof.nome,
      email: prof.email || '',
      telefone: prof.telefone || '',
      pix_comissao: prof.pix_comissao || '',
      auth_id: prof.auth_id || null,
    });
    modalForm.abrir();
  }

  async function handleSalvar(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      let isNovoAcesso = false;
      let payloadProfessor = { ...formProfessor };

      if (payloadProfessor.email && !payloadProfessor.auth_id) {
        const { data: alunoExistente } = await supabase
          .from('alunos')
          .select('auth_id')
          .eq('email', payloadProfessor.email.trim())
          .maybeSingle();

        if (alunoExistente) {
          payloadProfessor.auth_id = alunoExistente.auth_id;
        } else {
          const { data: funcData, error: funcError } = await supabase.functions.invoke('criar_usuario', {
            body: { email: payloadProfessor.email.trim(), nome: payloadProfessor.nome, role: 'professor' },
          });

          if (funcError) throw new Error('Falha na comunicação com o servidor seguro.');
          if (funcData?.error) {
            throw new Error(
              funcData.error === 'User already registered'
                ? 'Este e-mail já possui um acesso no sistema.'
                : funcData.error,
            );
          }

          payloadProfessor.auth_id = funcData.user.id;
          isNovoAcesso = true;
        }
      }

      await professoresService.salvar(payloadProfessor);
      showToast.success(
        isNovoAcesso
          ? 'Professor cadastrado e Acesso criado!'
          : 'Professor vinculado ao acesso existente com sucesso!',
      );
      modalForm.fechar();
      carregarProfessores();
    } catch (error) {
      showToast.error(error.message || 'Erro ao salvar dados.');
    } finally {
      setSaving(false);
    }
  }

  async function alternarStatus() {
    try {
      await professoresService.alternarStatus(profSelecionado.id, !profSelecionado.ativo);
      showToast.success(profSelecionado.ativo ? 'Professor desativado.' : 'Professor reativado!');
      modalStatus.fechar();
      carregarProfessores();
    } catch {
      showToast.error('Erro ao alterar status.');
    }
  }

  // ─── Skeleton de tabela usando DS ──────────────────────────────────────────
  function TabelaSkeleton() {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton.Row key={i} className="px-8 py-5" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground">Equipe de Professores</h1>
          <p className="text-muted-foreground">Gerencie os profissionais e seus acessos ao sistema.</p>
        </div>
        <Button variant="brand" size="lg" leftIcon={<UserPlus size={20} />} onClick={abrirModalCriar}>
          Novo Professor
        </Button>
      </div>

      {/* Barra de busca */}
      <Surface variant="card" padding="md">
        <Input
          leftIcon={<Search size={18} />}
          placeholder="Pesquisar por nome do professor..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </Surface>

      {/* Tabela */}
      <Surface variant="card" padding="none" className="overflow-hidden">
        {loading ? (
          <TabelaSkeleton />
        ) : professores.length > 0 ? (
          <table className="w-full text-left">
            <thead className="border-b border-border">
              <tr className="bg-muted">
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Professor</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contato</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Chave PIX</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {professores.map((prof) => (
                <tr key={prof.id} className="group hover:bg-muted/40 transition-colors">

                  {/* Professor */}
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-primary-soft rounded-full flex items-center justify-center font-black text-primary">
                        {prof.nome.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-foreground">{prof.nome}</p>
                        {prof.auth_id && (
                          <Badge tone="info" variant="soft" className="mt-1">
                            Com Acesso
                          </Badge>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Contato */}
                  <td className="px-8 py-5">
                    <span className="text-xs font-bold text-foreground block">
                      {prof.telefone || 'Sem telefone'}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {prof.email || 'Sem e-mail'}
                    </span>
                  </td>

                  {/* PIX */}
                  <td className="px-8 py-5">
                    <span className="text-xs font-black text-foreground bg-muted px-3 py-1.5 rounded-lg border border-border">
                      {prof.pix_comissao || 'Não cadastrada'}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-8 py-5">
                    <Badge tone={prof.ativo ? 'success' : 'destructive'} variant="soft">
                      <span className={`w-1.5 h-1.5 rounded-full ${prof.ativo ? 'bg-success' : 'bg-destructive'}`} />
                      {prof.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>

                  {/* Ações */}
                  <td className="px-8 py-5">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        onClick={() => abrirModalEditar(prof)}
                      >
                        <Edit2 size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Alterar status"
                        className="hover:text-primary hover:bg-primary-soft"
                        onClick={() => { setProfSelecionado(prof); modalStatus.abrir(); }}
                      >
                        <ShieldAlert size={16} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-20">
            <EmptyState
              icon={<Users size={28} />}
              title="Nenhum professor encontrado"
              description="Comece cadastrando seu primeiro professor."
            />
          </div>
        )}
      </Surface>

      {/* Modal Formulário */}
      <Modal
        aberto={modalForm.aberto}
        fechar={modalForm.fechar}
        title={formProfessor.id ? 'Editar Professor' : 'Cadastrar Professor'}
        size="md"
      >
        <form onSubmit={handleSalvar} className="space-y-5">

          <div>
            <Label required>Nome Completo</Label>
            <Input
              required
              placeholder="Nome do Professor"
              value={formProfessor.nome}
              onChange={(e) => setFormProfessor({ ...formProfessor, nome: e.target.value })}
            />
          </div>

          <div>
            <Label>E-mail (Gera acesso automático)</Label>
            <Input
              type="email"
              placeholder="email@exemplo.com"
              value={formProfessor.email}
              onChange={(e) => setFormProfessor({ ...formProfessor, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Telefone</Label>
              <Input
                placeholder="(00) 00000-0000"
                value={formProfessor.telefone}
                onChange={(e) => setFormProfessor({ ...formProfessor, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label>Chave PIX</Label>
              <Input
                placeholder="Para repasses"
                value={formProfessor.pix_comissao}
                onChange={(e) => setFormProfessor({ ...formProfessor, pix_comissao: e.target.value })}
              />
            </div>
          </div>

          <Modal.Footer>
            <Button variant="outline" onClick={modalForm.fechar} type="button">
              Cancelar
            </Button>
            <Button variant="brand" size="lg" loading={saving} fullWidth type="submit">
              {formProfessor.id ? 'Atualizar Cadastro' : 'Concluir e Criar Acesso'}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Modal Confirmação de Status */}
      <Modal
        aberto={modalStatus.aberto}
        fechar={modalStatus.fechar}
        title={profSelecionado?.ativo ? 'Desativar Professor?' : 'Reativar Professor?'}
        size="sm"
      >
        <p className="text-sm text-muted-foreground">
          Tem certeza que deseja{' '}
          <strong>{profSelecionado?.ativo ? 'desativar' : 'reativar'}</strong> o acesso de{' '}
          <strong>{profSelecionado?.nome}</strong>?
        </p>
        <Modal.Footer>
          <Button variant="outline" onClick={modalStatus.fechar}>
            Cancelar
          </Button>
          <Button
            variant={profSelecionado?.ativo ? 'destructive' : 'success'}
            onClick={alternarStatus}
          >
            {profSelecionado?.ativo ? 'Desativar' : 'Reativar'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}