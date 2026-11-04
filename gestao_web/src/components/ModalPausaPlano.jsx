import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calendar, FileText } from 'lucide-react';
import { alunosService } from '../services/alunosService';
import { financeiroService } from '../services/financeiroService';
import { showToast } from './shared/showToast';
import { formatarMoeda, hojeBrasilia, valorDevidoMensalidade } from '../lib/utils';
import { somarDias } from '../lib/agendaAluno';
import { calcularRetomada, cobrancasRemoviveis } from '../lib/pausaPlano';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';

// ILU-114: pausar, retomar e ajustar a previsão de volta do plano de um aluno.
// As regras ficam nas RPCs; aqui a gestão vê o efeito antes de confirmar.

const formatarData = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const plural = (n, palavra) => `${n} ${palavra}${n === 1 ? '' : 's'}`;

// Cobranças em aberto que vencem de `inicio` até a véspera de `fimExclusivo`.
// Entram marcadas para sair, porque vencimento dentro da pausa não é cobrado; a
// gestão pode desmarcar. Quem some da lista depois de trocar as datas não vai.
function useCobrancasDaPausa(alunoId, inicio, fimExclusivo) {
  const [desmarcadas, setDesmarcadas] = useState([]);
  const fim = fimExclusivo ? somarDias(fimExclusivo, -1) : '';
  const periodoValido = !!inicio && !!fim && inicio <= fim;

  // String: o perfil invalida esta chave com o id da URL, que é texto.
  const { data, isLoading } = useQuery({
    queryKey: ['aluno-cobrancas-em-aberto', String(alunoId), inicio, fim],
    queryFn: () => financeiroService.listarCobrancasPlanoEmAberto(alunoId, inicio, fim),
    enabled: periodoValido,
  });

  const cobrancas = periodoValido ? cobrancasRemoviveis(data) : [];
  return {
    periodoValido,
    cobrancas,
    carregando: periodoValido && isLoading,
    desmarcadas,
    alternar: (id) => setDesmarcadas((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    idsParaRemover: cobrancas.filter((c) => !desmarcadas.includes(c.id)).map((c) => c.id),
  };
}

function ListaCobrancas({ periodoValido, cobrancas, carregando, desmarcadas, alternar }) {
  if (!periodoValido) return null;
  if (carregando) {
    return <p className="text-xs font-medium text-muted-foreground">Verificando cobranças em aberto no período...</p>;
  }
  if (cobrancas.length === 0) {
    return <p className="text-xs font-medium text-muted-foreground">Nenhuma cobrança de plano em aberto vence neste período.</p>;
  }
  return (
    <div className="space-y-3 p-3 rounded-xl bg-warning-soft border border-warning/30">
      <div className="flex items-start gap-2 text-xs font-medium text-foreground">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-warning" />
        <span>
          {cobrancas.length === 1
            ? '1 cobrança em aberto vence dentro da pausa e será removida.'
            : `${cobrancas.length} cobranças em aberto vencem dentro da pausa e serão removidas.`}
          {' '}Desmarque a que deve continuar valendo.
        </span>
      </div>
      <ul className="space-y-1.5 max-h-40 overflow-y-auto">
        {cobrancas.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-3 px-3 py-2 rounded-lg bg-background border border-border text-sm cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={!desmarcadas.includes(c.id)}
                onChange={() => alternar(c.id)}
              />
              <span className="font-bold text-foreground">{formatarData(c.data_vencimento)}</span>
              <span className="text-muted-foreground">{formatarMoeda(valorDevidoMensalidade(c))}</span>
              <span className="ml-auto text-[10px] uppercase font-black text-muted-foreground tracking-wider">{c.status}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModalPausarPlano({ aluno, onClose, onSucesso }) {
  const hoje = hojeBrasilia();
  const [dataInicio, setDataInicio] = useState(hoje);
  const [dataPrevista, setDataPrevista] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const lista = useCobrancasDaPausa(aluno.id, dataInicio, dataPrevista);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await alunosService.pausarPlano(aluno.id, {
        data_inicio: dataInicio,
        data_prevista_volta: dataPrevista,
        motivo,
        cobrancas_remover: lista.idsParaRemover,
      });
      const detalhes = [
        r.reservas_canceladas > 0 && `${plural(r.reservas_canceladas, 'reserva')} cancelada${r.reservas_canceladas === 1 ? '' : 's'}`,
        r.cobrancas_removidas > 0 && `${plural(r.cobrancas_removidas, 'cobrança')} removida${r.cobrancas_removidas === 1 ? '' : 's'}`,
      ].filter(Boolean).join(', ');
      showToast.success(detalhes ? `Plano pausado: ${detalhes}.` : 'Plano pausado.');
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error(error.message || 'Erro ao pausar o plano.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={onClose} title="Pausar plano" description={aluno.nome_completo} size="md">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="pausa-inicio" className="block mb-1.5">Início da pausa</Label>
            <Input
              id="pausa-inicio"
              type="date"
              leftIcon={<Calendar size={18} />}
              value={dataInicio}
              max={hoje}
              onChange={(e) => setDataInicio(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="pausa-prevista" className="block mb-1.5">Previsão de volta</Label>
            <Input
              id="pausa-prevista"
              type="date"
              leftIcon={<Calendar size={18} />}
              value={dataPrevista}
              min={dataInicio ? somarDias(dataInicio, 1) : undefined}
              onChange={(e) => setDataPrevista(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="pausa-motivo" className="block mb-1.5">Motivo</Label>
          <Input
            id="pausa-motivo"
            leftIcon={<FileText size={18} />}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: atestado até 20/11"
            required
          />
        </div>

        <ul className="space-y-1.5 p-4 rounded-xl bg-muted text-xs font-medium text-muted-foreground list-disc list-inside">
          <li>Enquanto estiver pausado, o aluno não é cobrado, sai da grade e da chamada, libera a vaga e não agenda pelo app.</li>
          <li>Reservas a partir do início são canceladas, sem contar como falta.</li>
          <li>A previsão é só um lembrete: a volta é registrada à mão, e os dias pausados são somados ao vencimento (hoje {formatarData(aluno.data_fim_plano)}).</li>
        </ul>

        <ListaCobrancas {...lista} />

        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" variant="brand" loading={salvando}>Pausar plano</Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

export function ModalRetomarPlano({ aluno, pausa, onClose, onSucesso }) {
  const hoje = hojeBrasilia();
  const [dataRetorno, setDataRetorno] = useState(hoje);
  const [salvando, setSalvando] = useState(false);
  const lista = useCobrancasDaPausa(aluno.id, pausa.data_inicio, dataRetorno);
  const retomada = calcularRetomada({
    dataInicioPausa: pausa.data_inicio,
    dataRetorno,
    dataInicioPlano: aluno.data_inicio_plano,
    dataFimPlano: aluno.data_fim_plano,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await alunosService.retomarPlano(aluno.id, {
        data_retorno: dataRetorno,
        cobrancas_remover: lista.idsParaRemover,
      });
      showToast.success(`Plano retomado: ${plural(r.dias_devolvidos, 'dia')} de volta, novo vencimento em ${formatarData(r.data_fim_plano)}.`);
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error(error.message || 'Erro ao retomar o plano.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={onClose} title="Retomar plano" description={aluno.nome_completo} size="md">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        <div>
          <Label htmlFor="pausa-retorno" className="block mb-1.5">Data da volta</Label>
          <Input
            id="pausa-retorno"
            type="date"
            leftIcon={<Calendar size={18} />}
            value={dataRetorno}
            min={pausa.data_inicio}
            max={hoje}
            onChange={(e) => setDataRetorno(e.target.value)}
            required
          />
          <p className="text-xs font-medium text-muted-foreground mt-1.5">
            Pausado desde {formatarData(pausa.data_inicio)}. Se o aluno já voltou antes de hoje, informe o dia em que voltou.
          </p>
        </div>

        {retomada && (
          <div className="p-4 rounded-xl bg-muted">
            <p className="font-bold text-sm text-foreground">
              {plural(retomada.dias, 'dia')} de volta: vencimento passa de {formatarData(aluno.data_fim_plano)} para {formatarData(retomada.novoFim)}.
            </p>
            <p className="text-xs font-medium text-muted-foreground mt-1">
              O aluno volta aos mesmos horários fixos. A volta não gera cobrança: a automática retorna na geração do mês seguinte, e o que precisar antes disso é lançado à mão no Financeiro.
            </p>
          </div>
        )}

        <ListaCobrancas {...lista} />

        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" variant="brand" loading={salvando}>Retomar plano</Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

export function ModalAjustarPrevisao({ aluno, pausa, onClose, onSucesso }) {
  const [dataPrevista, setDataPrevista] = useState(pausa.data_prevista_volta);
  const [salvando, setSalvando] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await alunosService.ajustarPrevisaoPausa(aluno.id, dataPrevista);
      showToast.success(`Previsão de volta ajustada para ${formatarData(dataPrevista)}.`);
      onSucesso();
      onClose();
    } catch (error) {
      showToast.error(error.message || 'Erro ao ajustar a previsão.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto fechar={onClose} title="Ajustar previsão de volta" description={aluno.nome_completo} size="sm">
      <form onSubmit={handleSubmit} className="space-y-5 pt-2">
        <div>
          <Label htmlFor="pausa-nova-previsao" className="block mb-1.5">Nova previsão</Label>
          <Input
            id="pausa-nova-previsao"
            type="date"
            leftIcon={<Calendar size={18} />}
            value={dataPrevista}
            min={somarDias(pausa.data_inicio, 1)}
            onChange={(e) => setDataPrevista(e.target.value)}
            required
          />
        </div>
        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" variant="brand" loading={salvando}>Salvar</Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
