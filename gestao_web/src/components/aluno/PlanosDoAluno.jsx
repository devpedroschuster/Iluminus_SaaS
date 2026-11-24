import React, { useState } from 'react';
import { CreditCard, Pause, Play, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { derivarPlanoVigente } from '../../lib/utils';
import { planosValidos, situacaoPlano, rotuloPlanoAluno } from '../../lib/planosAluno';
import { alunosService } from '../../services/alunosService';
import { showToast } from '../shared/showToast';
import Surface from '../ui/Surface';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { ModalConfirmacao } from '../ui/Modal';

// ILU-127 (entrega 4): aba "Planos" do perfil — um cartão por plano válido do
// aluno, com renovar, pausar/retomar e encerrar daquele plano, e a lista dos
// planos que já encerraram. Os modais de renovar e de pausa ficam no perfil
// (o aviso de pausa no topo também os abre); encerrar e desfazer ficam aqui.

const formatarDataCurta = (iso) => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano.slice(-2)}`;
};

const plural = (n, palavra) => `${n} ${palavra}${n === 1 ? '' : 's'}`;

function CartaoPlano({ planoAluno, rotulo, ciclos, hoje, processando, onRenovar, onPausar, onRetomar, onAjustar, onEncerrar, onDesfazer }) {
  const situacao = situacaoPlano(planoAluno, hoje);
  const pausado = !!planoAluno.pausado_desde;
  // Forma de recebimento e período do ciclo vigente deste plano.
  const ciclo = derivarPlanoVigente(ciclos);
  const inicioCiclo = ciclo?.data_inicio ?? planoAluno.data_inicio;
  const fimCiclo = ciclo?.data_fim ?? planoAluno.data_fim;

  return (
    <Surface variant="card" padding="lg" className="flex flex-col gap-4">
      <div className="space-y-2">
        <h4 className="font-black text-foreground text-lg leading-tight">{rotulo}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={situacao.tone} variant="soft">{situacao.rotulo}</Badge>
          {ciclo && (
            <Badge tone={ciclo.forma_recebimento === 'a_vista' ? 'brand' : 'neutral'} variant="soft">
              {ciclo.forma_recebimento === 'a_vista' ? 'À vista' : 'Recorrente'}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-0.5 text-sm">
        <p className="font-medium text-muted-foreground">
          Ciclo {formatarDataCurta(inicioCiclo)} – {formatarDataCurta(fimCiclo)}
        </p>
        <p className="font-bold text-foreground">Vence {formatarDataCurta(planoAluno.data_fim)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-auto">
        <Button
          variant="brand"
          size="sm"
          leftIcon={<RefreshCw size={14} />}
          disabled={pausado || !!processando}
          title={pausado ? 'Retome o plano antes de renovar' : undefined}
          onClick={onRenovar}
        >
          Renovar
        </Button>
        {pausado ? (
          <>
            <Button variant="outline" size="sm" leftIcon={<Play size={14} />} disabled={!!processando} onClick={onRetomar}>
              Retomar
            </Button>
            <Button variant="outline" size="sm" disabled={!!processando} onClick={onAjustar}>
              Ajustar previsão
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Pause size={14} />}
            title="Pausa o plano sem cancelar nem inativar o aluno"
            disabled={!!processando}
            onClick={onPausar}
          >
            Pausar
          </Button>
        )}
        {situacao.encerrando ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw size={14} />}
            loading={processando === planoAluno.id}
            disabled={!!processando}
            onClick={onDesfazer}
          >
            Desfazer encerramento
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<XCircle size={14} />}
            disabled={!!processando}
            onClick={onEncerrar}
          >
            Encerrar plano
          </Button>
        )}
      </div>
    </Surface>
  );
}

export default function PlanosDoAluno({
  planosAluno,
  ciclos,
  hoje,
  onAdicionar,
  onRenovar,
  onPausar,
  onRetomar,
  onAjustar,
  onAlterado,
}) {
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(null);
  const [processando, setProcessando] = useState(null);

  const todos = planosAluno ?? [];
  const validos = planosValidos(todos, hoje);
  const idsValidos = new Set(validos.map((p) => p.id));
  const encerrados = todos.filter((p) => !idsValidos.has(p.id));
  const rotuloValido = (p) => rotuloPlanoAluno(p, validos);
  const rotuloEncerrado = (p) => rotuloPlanoAluno(p, todos);
  const ciclosDe = (planoAlunoId) => (ciclos ?? []).filter((c) => c.plano_aluno_id === planoAlunoId);

  const encerrar = async () => {
    const plano = confirmandoEncerrar;
    if (!plano) return;
    setProcessando(plano.id);
    try {
      const r = await alunosService.encerrarPlano(plano.id);
      const removidas = Array.isArray(r?.cobrancas_removidas) ? r.cobrancas_removidas.length : 0;
      const detalhe = removidas > 0
        ? ` ${plural(removidas, 'cobrança')} em aberto removida${removidas === 1 ? '' : 's'}.`
        : '';
      showToast.success(`Plano ${rotuloValido(plano)} encerrado: vale até ${formatarDataCurta(r?.encerrado_em)}.${detalhe}`);
      onAlterado();
    } catch (err) {
      showToast.error(err.message);
    } finally {
      setProcessando(null);
    }
  };

  const desfazer = async (plano) => {
    setProcessando(plano.id);
    try {
      await alunosService.desfazerEncerramento(plano.id);
      showToast.success(`Encerramento do plano ${rotuloValido(plano)} desfeito.`);
      onAlterado();
    } catch (err) {
      showToast.error(err.message);
    } finally {
      setProcessando(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h3 className="font-black text-foreground text-xl">Planos do aluno</h3>
        <Button variant="brand" size="lg" onClick={onAdicionar}>
          {validos.length > 0 ? '+ Adicionar outro plano' : '+ Adicionar plano'}
        </Button>
      </div>

      {planosAluno === undefined ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Surface variant="card" padding="lg" className="h-48 animate-pulse" />
        </div>
      ) : validos.length === 0 ? (
        <Surface variant="card" padding="xl" className="text-center">
          <CreditCard size={32} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">
            {todos.length === 0 ? 'Nenhum plano cadastrado' : 'Nenhum plano ativo'}
          </p>
        </Surface>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {validos.map((plano) => (
            <CartaoPlano
              key={plano.id}
              planoAluno={plano}
              rotulo={rotuloValido(plano)}
              ciclos={ciclosDe(plano.id)}
              hoje={hoje}
              processando={processando}
              onRenovar={() => onRenovar(plano, rotuloValido(plano))}
              onPausar={() => onPausar(plano)}
              onRetomar={() => onRetomar(plano)}
              onAjustar={() => onAjustar(plano)}
              onEncerrar={() => setConfirmandoEncerrar(plano)}
              onDesfazer={() => desfazer(plano)}
            />
          ))}
        </div>
      )}

      {encerrados.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-black text-foreground">Planos encerrados</h4>
          <Surface variant="card" padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {encerrados.map((plano) => (
                <li key={plano.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <p className="font-bold text-foreground">{rotuloEncerrado(plano)}</p>
                    <p className="text-xs font-medium text-muted-foreground">
                      Fim {formatarDataCurta(plano.encerrado_em ?? plano.data_fim)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<RefreshCw size={14} />}
                    disabled={!!processando}
                    onClick={() => onRenovar(plano, rotuloEncerrado(plano))}
                  >
                    Renovar
                  </Button>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      )}

      <ModalConfirmacao
        aberto={!!confirmandoEncerrar}
        fechar={() => setConfirmandoEncerrar(null)}
        onConfirm={encerrar}
        titulo="Encerrar plano?"
        mensagem={!confirmandoEncerrar
          ? ''
          : confirmandoEncerrar.data_fim && confirmandoEncerrar.data_fim < hoje
            ? `O plano ${rotuloValido(confirmandoEncerrar)} já venceu em ${formatarDataCurta(confirmandoEncerrar.data_fim)}. O encerramento vale agora: ele sai dos avisos, e as modalidades e horários fixos dele são liberados. Cobranças em aberto com vencimento depois dessa data são removidas.`
            : `O plano ${rotuloValido(confirmandoEncerrar)} vale até ${formatarDataCurta(confirmandoEncerrar.data_fim ?? hoje)}. Depois disso ele sai dos avisos, e as modalidades e horários fixos dele são liberados. Cobranças em aberto com vencimento depois dessa data são removidas.`}
        textoConfirmar="Encerrar plano"
        tipo="warning"
        loading={!!confirmandoEncerrar && processando === confirmandoEncerrar.id}
      />
    </div>
  );
}
