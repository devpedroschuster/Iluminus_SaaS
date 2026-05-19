import React, { useEffect, useState } from 'react';
import { planosService } from '../services/planosService';
import { Plus, Trash2, Package, RefreshCw, Calendar, Edit2, Clock } from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import Modal, { useModal } from '../components/ui/Modal';
import { ModalConfirmacao } from '../components/shared/Modal';
import Input, { Label } from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';
import Badge from '../components/ui/Badge';
import Skeleton from '../components/ui/Skeleton';

export default function Planos() {
  const [planos, setPlanos] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [novoPlano, setNovoPlano] = useState({
    nome: '', preco: '', frequencia_semanal: '', duracao_meses: 1, regras_acesso: []
  });

  const modalEdicao = useModal();
  const [savingEdit, setSavingEdit] = useState(false);
  const [planoEmEdicao, setPlanoEmEdicao] = useState(null);

  const modalExcluir = useModal();
  const [planoParaExcluir, setPlanoParaExcluir] = useState(null);

  useEffect(() => { fetchPlanos(); }, []);

  async function fetchPlanos() {
    try {
      const data = await planosService.listar();
      setPlanos(data || []);
    } catch (err) {
      showToast.error("Erro ao carregar planos.");
    } finally {
      setLoadingList(false);
    }
  }

  async function handleCriarPlano(e) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      await planosService.salvar(novoPlano);
      showToast.success("Plano criado com sucesso!");
      setNovoPlano({ nome: '', preco: '', frequencia_semanal: '', duracao_meses: 1, regras_acesso: [] });
      fetchPlanos();
    } catch (err) {
      showToast.error("Erro ao criar plano.");
    } finally {
      setCreating(false);
    }
  }

  async function excluirPlano() {
    if (!planoParaExcluir) return;
    setDeletingId(planoParaExcluir.id);
    modalExcluir.fechar();
    try {
      await planosService.excluir(planoParaExcluir.id);
      showToast.success("Plano removido.");
      fetchPlanos();
    } catch (err) {
      showToast.error("Erro ao excluir. Verifique se há alunos vinculados a ele.");
    } finally {
      setDeletingId(null);
      setPlanoParaExcluir(null);
    }
  }

  function abrirEdicao(plano) {
    setPlanoEmEdicao({ ...plano, duracao_meses: plano.duracao_meses || 1, regras_acesso: plano.regras_acesso || [] });
    modalEdicao.abrir();
  }

  async function handleSalvarEdicao(e) {
    e.preventDefault();
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      await planosService.salvar(planoEmEdicao);
      showToast.success("Plano atualizado com sucesso!");
      modalEdicao.fechar();
      fetchPlanos();
    } catch (err) {
      showToast.error("Erro ao atualizar plano.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in max-w-full">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">Planos e Mensalidades</h1>
        <p className="text-muted-foreground">Cadastre e edite os pacotes comerciais vendidos no estúdio.</p>
      </div>

      {/* Formulário de criação */}
      <Surface variant="card" padding="lg" className="w-full">
        <h3 className="font-bold text-foreground mb-6 flex items-center gap-2">
          <Package size={20} className="text-primary" /> Criar Novo Plano
        </h3>

        <form onSubmit={handleCriarPlano} className="space-y-4 w-full">
          <div className="flex flex-col md:flex-row gap-4 items-end w-full">
            {/* Nome */}
            <div className="flex-1 w-full space-y-1.5">
              <Label>Nome do Plano</Label>
              <Input
                required
                placeholder="Ex: Livre Dança"
                value={novoPlano.nome}
                onChange={e => setNovoPlano({ ...novoPlano, nome: e.target.value })}
              />
            </div>

            {/* Preço */}
            <div className="w-full md:w-32 space-y-1.5">
              <Label>Preço (R$)</Label>
              <Input
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                value={novoPlano.preco}
                onChange={e => setNovoPlano({ ...novoPlano, preco: e.target.value })}
              />
            </div>

            {/* Frequência */}
            <div className="w-full md:w-36 space-y-1.5">
              <Label>Freq. Visível</Label>
              <Input
                required
                placeholder="Ex: Livre"
                value={novoPlano.frequencia_semanal}
                onChange={e => setNovoPlano({ ...novoPlano, frequencia_semanal: e.target.value })}
              />
            </div>

            {/* Duração */}
            <div className="w-full md:w-32 space-y-1.5">
              <Label>Duração (Meses)</Label>
              <Input
                required
                type="number"
                min="1"
                max="24"
                className="font-black text-info"
                value={novoPlano.duracao_meses}
                onChange={e => setNovoPlano({ ...novoPlano, duracao_meses: e.target.value })}
              />
            </div>

            <Button
              type="submit"
              variant="brand"
              size="lg"
              loading={creating}
              leftIcon={!creating ? <Plus size={20} /> : undefined}
              className="w-full md:w-auto mt-4 md:mt-0"
            >
              {creating ? "Salvando..." : "Salvar"}
            </Button>
          </div>

          <SeletorRegras
            regras={novoPlano.regras_acesso}
            setRegras={(novasRegras) => setNovoPlano({ ...novoPlano, regras_acesso: novasRegras })}
          />
        </form>
      </Surface>

      {/* Grade de planos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingList ? (
          [1, 2, 3].map(i => <Skeleton.Card key={i} className="h-24" />)
        ) : planos.map(plano => (
          <Surface
            key={plano.id}
            variant="card"
            padding="md"
            className="flex justify-between items-center hover:shadow-md hover:-translate-y-0.5 transition-all group"
          >
            <div className="flex items-center gap-4">
              {/* Ícone — bg-primary-soft text-primary (substitui bg-orange-50 text-primary) */}
              <div className="bg-primary-soft p-4 rounded-2xl text-primary shrink-0">
                <Package size={24} />
              </div>
              <div>
                {/* Cabeçalho — text-foreground (substitui text-gray-800) */}
                <h3 className="font-black text-lg text-foreground leading-tight">{plano.nome}</h3>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground mt-1">
                  {/* Preço — text-success (substitui text-green-600 sem semântica) */}
                  <span className="text-success font-black">R$ {plano.preco}</span>
                  <span className="w-1 h-1 bg-border rounded-full" />
                  <span className="flex items-center gap-1">
                    <Calendar size={12} /> {plano.frequencia_semanal}
                  </span>
                  <span className="w-1 h-1 bg-border rounded-full" />
                  {/* Duração — text-info (substitui text-blue-500 sem semântica) */}
                  <span className="flex items-center gap-1 text-info font-bold">
                    <Clock size={12} /> {plano.duracao_meses} {plano.duracao_meses > 1 ? 'Meses' : 'Mês'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              {/* Editar — hover:text-info hover:bg-info-soft (substitui hover:text-blue-500 hover:bg-blue-50) */}
              <button
                onClick={() => abrirEdicao(plano)}
                className="p-3 text-muted-foreground hover:text-info hover:bg-info-soft rounded-xl transition-all"
                title="Editar Plano"
              >
                <Edit2 size={18} />
              </button>
              {/* Excluir — hover:text-destructive hover:bg-destructive-soft (substitui hover:text-red-500 hover:bg-red-50) */}
              <button
                onClick={() => { setPlanoParaExcluir(plano); modalExcluir.abrir(); }}
                disabled={deletingId === plano.id}
                className="p-3 text-muted-foreground hover:text-destructive hover:bg-destructive-soft rounded-xl transition-all"
                title="Excluir Plano"
              >
                {deletingId === plano.id
                  ? <RefreshCw className="animate-spin text-destructive" size={18} />
                  : <Trash2 size={18} />}
              </button>
            </div>
          </Surface>
        ))}
      </div>

      {/* Modal de edição — usa ui/Modal (DS) */}
      <Modal
        aberto={modalEdicao.aberto}
        fechar={modalEdicao.fechar}
        title="Editar Pacote / Plano"
        size="md"
      >
        {planoEmEdicao && (
          <form onSubmit={handleSalvarEdicao} className="space-y-6 pt-2">
            <div className="space-y-1.5">
              <Label>Nome Comercial do Plano</Label>
              <Input
                required
                value={planoEmEdicao.nome}
                onChange={e => setPlanoEmEdicao({ ...planoEmEdicao, nome: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Preço de Venda</Label>
                {/* text-success (substitui text-green-600 sem semântica DS) */}
                <Input
                  required
                  type="number"
                  step="0.01"
                  className="font-bold text-success"
                  value={planoEmEdicao.preco}
                  onChange={e => setPlanoEmEdicao({ ...planoEmEdicao, preco: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Frequência</Label>
                <Input
                  required
                  value={planoEmEdicao.frequencia_semanal}
                  onChange={e => setPlanoEmEdicao({ ...planoEmEdicao, frequencia_semanal: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Duração (Meses)</Label>
                {/* text-info (substitui text-blue-600 sem semântica DS) */}
                <Input
                  required
                  type="number"
                  min="1"
                  max="24"
                  className="font-black text-info"
                  value={planoEmEdicao.duracao_meses}
                  onChange={e => setPlanoEmEdicao({ ...planoEmEdicao, duracao_meses: e.target.value })}
                />
              </div>
            </div>

            <SeletorRegras
              regras={planoEmEdicao.regras_acesso}
              setRegras={(novasRegras) => setPlanoEmEdicao({ ...planoEmEdicao, regras_acesso: novasRegras })}
            />

            <Modal.Footer>
              <Button variant="ghost" type="button" onClick={modalEdicao.fechar}>
                Cancelar
              </Button>
              {/* Botão de salvar — variant="brand" (substitui bg-blue-600 hardcoded) */}
              <Button variant="brand" type="submit" loading={savingEdit}>
                {savingEdit ? "Salvando..." : "Atualizar Plano"}
              </Button>
            </Modal.Footer>
          </form>
        )}
      </Modal>

      <ModalConfirmacao
        isOpen={modalExcluir.aberto}
        onClose={modalExcluir.fechar}
        onConfirm={excluirPlano}
        titulo="Remover Pacote / Plano?"
        mensagem={`Tem certeza que deseja excluir o plano "${planoParaExcluir?.nome}" permanentemente?`}
        tipo="danger"
      />
    </div>
  );
}

// ─── SeletorRegras ────────────────────────────────────────────────────────────

function SeletorRegras({ regras, setRegras }) {
  const [mod, setMod] = useState('Dança');
  const [qty, setQty] = useState('1');

  const adicionarRegra = () => {
    if (regras.some(r => r.modalidade === mod)) {
      showToast.error(`A regra para ${mod} já existe neste plano.`);
      return;
    }
    setRegras([...regras, { modalidade: mod, limite: Number(qty) }]);
  };

  const removerRegra = (index) => {
    const novas = [...regras];
    novas.splice(index, 1);
    setRegras(novas);
  };

  return (
    <div className="space-y-4 border-t border-border pt-6 mt-6 w-full">
      <Label>Regras de Acesso do Pacote</Label>

      {/* Regras já adicionadas */}
      {regras.map((regra, index) => (
        <div
          key={index}
          className="flex gap-2 items-center bg-muted p-3 rounded-2xl animate-in slide-in-from-left-2 border border-border"
        >
          <div className="flex-1 font-bold text-foreground text-sm">Área: {regra.modalidade}</div>
          {/* text-info (substitui text-blue-600 sem semântica DS) */}
          <div className="font-black text-info bg-card px-3 py-1 rounded-lg border border-border">
            {regra.limite === 999 ? 'Ilimitado (Livre)' : `${regra.limite}x na semana`}
          </div>
          {/* Remover — text-destructive (substitui text-red-400) */}
          <button
            type="button"
            onClick={() => removerRegra(index)}
            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      {/* Painel para adicionar nova regra — bg-info-soft (substitui bg-blue-50/50) */}
      <div className="grid grid-cols-5 gap-2 items-end bg-info-soft p-4 rounded-3xl border border-dashed border-info/20">
        <div className="col-span-2 space-y-1.5">
          {/* text-info (substitui text-blue-400) */}
          <label className="text-[9px] font-black text-info uppercase ml-2 block">Categoria</label>
          <Input
            as="select"
            value={mod}
            onChange={e => setMod(e.target.value)}
          >
            <option value="Dança">Dança</option>
            <option value="Funcional">Funcional</option>
          </Input>
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="text-[9px] font-black text-info uppercase ml-2 block">Limite na Semana</label>
          {/* text-info (substitui text-blue-700) */}
          <Input
            as="select"
            className="font-black text-info"
            value={qty}
            onChange={e => setQty(e.target.value)}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="4">4x</option>
            <option value="5">5x</option>
            <option value="6">6x</option>
            <option value="999">Ilimitado (Livre)</option>
          </Input>
        </div>
        {/* Botão — variant="info" (substitui bg-blue-600 hardcoded) */}
        <Button
          type="button"
          variant="info"
          size="icon"
          onClick={adicionarRegra}
        >
          <Plus size={20} />
        </Button>
      </div>
    </div>
  );
}