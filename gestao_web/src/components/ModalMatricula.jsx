import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Package, Loader2, ClipboardList, CalendarDays, Tag, Dumbbell, AlertTriangle } from 'lucide-react';
import { showToast } from '../components/shared/Toast';
import { alunosService } from '../services/alunosService';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';
import { cn } from '../lib/cn';

export default function ModalMatricula({ aluno, onClose, onMatriculaSucesso }) {
  const [planos, setPlanos] = useState([]);
  const [modalidades, setModalidades] = useState([]);

  const [planoSelecionado, setPlanoSelecionado] = useState(aluno?.plano_id || '');
  const [modalidadesSelecionadas, setModalidadesSelecionadas] = useState(
    aluno?.modalidades_selecionadas || []
  );
  const [dataVencimento, setDataVencimento] = useState(new Date().toISOString().split('T')[0]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const planoDetalhes = planos.find(p => p.id === planoSelecionado) || null;

  const dataVencimentoFormatada = dataVencimento
    ? new Date(dataVencimento + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    setLoading(true);
    try {
      const { data: planosData } = await supabase
        .from('planos')
        .select('id, nome, preco, duracao_meses, regras_acesso');

      const { data: modData } = await supabase.from('modalidades').select('nome').order('nome');

      if (planosData) setPlanos(planosData);
      if (modData) setModalidades(modData);
    } catch (error) {
      console.error('Erro ao carregar dados', error);
      showToast.error('Erro ao carregar planos');
    } finally {
      setLoading(false);
    }
  }

  const handleMatricular = async (e) => {
    e.preventDefault();
    if (!planoSelecionado) return;
    setSaving(true);
    try {
      await alunosService.matricular(aluno.id, planoSelecionado, {
        dataVencimento,
        modalidades: modalidadesSelecionadas,
        isNovaMatricula: true,
      });
      showToast.success('Matrícula realizada com sucesso!');
      onMatriculaSucesso();
      onClose();
    } catch (error) {
      console.error(error);
      showToast.error('Erro ao efetivar matrícula: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal aberto={true} fechar={onClose} hideClose size="sm">
        <div className="flex flex-col items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary mb-4" size={40} />
          <p className="text-muted-foreground font-medium">Carregando planos...</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      aberto={true}
      fechar={onClose}
      title={`Matricular: ${aluno?.nome_completo?.split(' ')[0]}`}
      size="md"
    >
      <form onSubmit={handleMatricular} className="space-y-6 pt-2">

        {/* Cartões de Planos */}
        <div>
          <Label className="block mb-2 flex items-center gap-2">
            <Package size={18} className="text-primary" />
            Selecione o Plano
          </Label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {planos.map(plano => {
              const isSelected = planoSelecionado === plano.id;
              return (
                <div
                  key={plano.id}
                  onClick={() => setPlanoSelecionado(plano.id)}
                  className={cn(
                    'p-4 rounded-2xl border-2 cursor-pointer transition-all',
                    isSelected
                      ? 'border-primary bg-primary-soft shadow-sm'
                      : 'border-border bg-card hover:border-subtle'
                  )}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className={cn('font-bold pr-2', isSelected ? 'text-primary' : 'text-foreground')}>
                      {plano.nome}
                    </h3>
                    {isSelected && <CheckCircle2 size={20} className="text-primary shrink-0" />}
                  </div>
                  <div className="mt-1 flex items-end justify-between">
                    <div>
                      <span className="text-xs text-muted-foreground block mb-0.5">Valor</span>
                      <span className="font-black text-lg text-foreground">
                        R$ {plano.preco.toFixed(2)}
                      </span>
                    </div>
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider',
                      isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                      {plano.duracao_meses} {plano.duracao_meses === 1 ? 'mês' : 'meses'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modalidades */}
        <div className="bg-muted p-4 rounded-2xl border border-border">
          <Label className="block mb-3">Quais modalidades ele vai cursar?</Label>
          <div className="flex flex-wrap gap-2">
            {modalidades.map(mod => (
              <label
                key={mod.nome}
                className="flex items-center gap-2 cursor-pointer bg-card px-3 py-2 rounded-xl border border-border hover:bg-subtle transition-colors"
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-ring focus:ring-2"
                  checked={modalidadesSelecionadas.includes(mod.nome)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setModalidadesSelecionadas([...modalidadesSelecionadas, mod.nome]);
                    } else {
                      setModalidadesSelecionadas(modalidadesSelecionadas.filter(m => m !== mod.nome));
                    }
                  }}
                />
                <span className="text-sm font-bold text-foreground">{mod.nome}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Data do Primeiro Pagamento */}
        <div className="bg-info-soft p-4 rounded-2xl border border-info/20">
          <Label className="block text-info-foreground mb-2">
            Data do 1º Pagamento (Combinada)
          </Label>
          <Input
            type="date"
            value={dataVencimento}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setDataVencimento(e.target.value)}
            className="bg-card font-bold"
          />
          <p className="text-[11px] text-info-foreground/80 mt-2 font-medium">
            O plano terá validade de 30 dias a partir desta data de pagamento.
          </p>
        </div>

        {/* Resumo de Confirmação */}
        {planoDetalhes ? (
          <div className="rounded-2xl border-2 border-primary/30 bg-primary-soft overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-primary/10 border-b border-primary/20">
              <ClipboardList size={16} className="text-primary" />
              <span className="text-sm font-bold text-primary uppercase tracking-wide">
                Resumo da Matrícula
              </span>
            </div>

            {/* Itens */}
            <div className="p-4 space-y-3">
              {/* Plano */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Tag size={14} className="text-primary" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Plano</p>
                  <p className="font-bold text-foreground">
                    {planoDetalhes.nome}
                    <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary uppercase">
                      {planoDetalhes.duracao_meses} {planoDetalhes.duracao_meses === 1 ? 'mês' : 'meses'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Valor */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-success font-black text-[11px]">R$</span>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Valor</p>
                  <p className="font-black text-lg text-foreground leading-tight">
                    R$ {planoDetalhes.preco.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Data de Vencimento */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-info/10 flex items-center justify-center shrink-0 mt-0.5">
                  <CalendarDays size={14} className="text-info" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">1º Pagamento</p>
                  <p className="font-bold text-foreground">{dataVencimentoFormatada}</p>
                </div>
              </div>

              {/* Modalidades */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-warning/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Dumbbell size={14} className="text-warning" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Modalidades</p>
                  {modalidadesSelecionadas.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {modalidadesSelecionadas.map(mod => (
                        <span
                          key={mod}
                          className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-warning/10 text-warning-foreground border border-warning/20"
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Nenhuma selecionada</p>
                  )}
                </div>
              </div>
            </div>

            {/* Alerta de confirmação */}
            <div className="mx-4 mb-4 flex items-center gap-2 bg-warning/10 border border-warning/25 rounded-xl px-3 py-2">
              <AlertTriangle size={14} className="text-warning shrink-0" />
              <p className="text-[11px] text-warning-foreground font-medium">
                Confira os dados acima antes de confirmar. Essa ação registrará a matrícula.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-border bg-muted/40 px-4 py-5 flex items-center gap-3 text-muted-foreground">
            <ClipboardList size={18} className="shrink-0" />
            <p className="text-sm font-medium">
              Selecione um plano acima para ver o resumo antes de confirmar.
            </p>
          </div>
        )}

        {/* Ação */}
        <div className="pt-2">
          <Button
            type="submit"
            variant="brand"
            size="lg"
            fullWidth
            loading={saving}
            disabled={saving || !planoSelecionado}
          >
            {saving ? 'Processando...' : 'Registrar Matrícula'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}