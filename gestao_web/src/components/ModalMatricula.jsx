import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Package, Loader2 } from 'lucide-react';
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
            {saving ? 'Processando...' : 'Confirmar Matrícula e Cobrar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}