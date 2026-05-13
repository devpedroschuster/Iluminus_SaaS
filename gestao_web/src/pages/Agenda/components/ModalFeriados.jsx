import React from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { ModalConfirmacao } from '../../../components/shared/Modal';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

export default function ModalFeriados({ 
  feriados, novoFeriado, setNovoFeriado, savingFeriado, salvarFeriado, 
  feriadoParaExcluir, solicitarExclusao, confirmarExclusao, cancelarExclusao 
}) {
  return (
    <div className="space-y-6 pt-2">
      <form onSubmit={salvarFeriado} className="flex gap-2">
        <Input 
          type="date" 
          required 
          value={novoFeriado.data} 
          onChange={e => setNovoFeriado({...novoFeriado, data: e.target.value})} 
          wrapperClassName="w-40"
        />
        <Input 
          type="text" 
          required 
          placeholder="Motivo (ex: Feriado Nacional)" 
          value={novoFeriado.descricao} 
          onChange={e => setNovoFeriado({...novoFeriado, descricao: e.target.value})} 
        />
        <Button 
          type="submit" 
          variant="primary" 
          size="icon"
          loading={savingFeriado}
        >
          {savingFeriado ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
        </Button>
      </form>

      <div>
        <h4 className="font-bold text-sm text-foreground mb-3">Bloqueios Futuros</h4>
        {feriados.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum bloqueio cadastrado.</p>
        ) : (
          <ul className="space-y-2">
            {feriados.map(f => (
              <li key={f.id} className="flex justify-between items-center p-3 bg-destructive-soft text-destructive rounded-xl border border-destructive/20">
                <div>
                  <span className="font-black text-sm block">{new Date(f.data + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                  <span className="text-xs opacity-90">{f.descricao}</span>
                </div>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="icon"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => solicitarExclusao(f.id)} 
                >
                   <Trash2 size={18} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ModalConfirmacao 
        isOpen={!!feriadoParaExcluir} 
        onClose={cancelarExclusao} 
        onConfirm={confirmarExclusao} 
        titulo="Remover Bloqueio" 
        mensagem="Tem certeza que deseja remover este bloqueio da agenda?" 
        tipo="danger" 
      />
    </div>
  );
}