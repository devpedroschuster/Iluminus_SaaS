import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { showToast } from './shared/showToast';
import { montarInstrucoesAcesso } from '../lib/utils';

// ILU-76: mostra uma única vez o login e a senha provisória gerados pela
// Edge Function criar_usuario, para o admin repassar ao aluno (WhatsApp).
// Não fecha clicando fora: a senha não pode ser exibida de novo (se perder,
// o admin gera outra no Perfil do Aluno).
export default function ModalCredenciaisAcesso({ aberto, fechar, credenciais, tipo = 'novo' }) {
  const [copiado, setCopiado] = useState(false);

  if (!credenciais) return null;
  const { nome, email, senha } = credenciais;

  async function copiarInstrucoes() {
    try {
      await navigator.clipboard.writeText(
        montarInstrucoesAcesso({ nome, email, senha, origem: window.location.origin, tipo }),
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      showToast.success('Instruções copiadas!');
    } catch {
      showToast.error('Não foi possível copiar. Copie o login e a senha manualmente.');
    }
  }

  return (
    <Modal
      aberto={aberto}
      fechar={fechar}
      title={tipo === 'nova_senha' ? 'Nova senha gerada' : 'Acesso criado!'}
      size="sm"
      closeOnOverlay={false}
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Repasse estas instruções a <strong className="text-foreground">{nome}</strong>.
          A senha provisória não poderá ser exibida novamente.
          {tipo === 'nova_senha' && ' A senha anterior deixou de funcionar e o aluno foi desconectado.'}
        </p>

        <div className="rounded-2xl bg-muted p-4 space-y-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Login</span>
            <p className="font-bold text-foreground break-all">{email}</p>
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Senha provisória</span>
            <p className="font-mono font-bold text-foreground break-all select-all">{senha}</p>
          </div>
        </div>

        <Button
          variant="brand"
          size="lg"
          className="w-full"
          leftIcon={copiado ? <Check size={18} /> : <Copy size={18} />}
          onClick={copiarInstrucoes}
        >
          Copiar instruções
        </Button>
      </div>
    </Modal>
  );
}
