import React from 'react';
import { UserCheck, RefreshCw, MessageCircle } from 'lucide-react';
import { ModalConfirmacao } from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Input, { Label } from '../../../components/ui/Input';

// Configuração do modal de aviso conforme o tipo de bloqueio.
function resolverConfigModal(tipo, msg) {
  if (tipo === 'plano') {
    return {
      titulo: 'Fora do plano do aluno',
      mensagem: `${msg} Você tem ciência que este agendamento está fora do plano contratado pelo aluno. Deseja prosseguir mesmo assim?`,
      textoBotaoConfirmar: 'Sim, agendar mesmo assim',
    };
  }
  // tipo === 'lotacao' ou fallback
  return {
    titulo: 'Turma lotada',
    mensagem: `${msg} Deseja agendar mesmo assim?`,
    textoBotaoConfirmar: 'Agendar mesmo assim',
  };
}

export default function ModalAgendamento({
  agendamentoForm, setAgendamentoForm, aulas, listaAlunos, handleAgendarAluno,
  savingAgendamento, infoVaga, verificandoVaga,
  modalLotacao, confirmarAgendamentoLotado, cancelarAgendamentoLotado
}) {
  const configModal = resolverConfigModal(modalLotacao?.tipo, modalLotacao?.msg);

  return (
    <>
      <form onSubmit={(e) => handleAgendarAluno(e)} className="space-y-4 pt-2">
        <div className="flex bg-muted p-1 rounded-2xl mb-4 border border-border">
          <button
            type="button"
            onClick={() => setAgendamentoForm({ ...agendamentoForm, tipo: 'cadastrado' })}
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'cadastrado' ? 'bg-card shadow-sm text-info' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Aluno da Casa
          </button>
          <button
            type="button"
            onClick={() => setAgendamentoForm({ ...agendamentoForm, tipo: 'visitante' })}
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'visitante' ? 'bg-card shadow-sm text-warning' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Aula Experimental
          </button>
        </div>

        {/* Seleção da aula — enriquece _nomeAtividade */}
        <Input
          as="select"
          required
          value={agendamentoForm.aula_id}
          onChange={e => {
            const aula = aulas.find(a => a.id === e.target.value);
            setAgendamentoForm({
              ...agendamentoForm,
              aula_id: e.target.value,
              _nomeAtividade: aula?.atividade || '',
            });
          }}
        >
          <option value="">Selecione a aula da grade...</option>
          {aulas.map(aula => (
            <option key={aula.id} value={aula.id}>
              {aula.atividade} - {aula.eh_recorrente ? aula.dia_semana : 'Evento Único'} às {aula.horario?.slice(0, 5)}
            </option>
          ))}
        </Input>

        {agendamentoForm.tipo === 'cadastrado' ? (
          /* Seleção de aluno cadastrado — enriquece _nomeAluno */
          <Input
            as="select"
            required
            value={agendamentoForm.aluno_id}
            onChange={e => {
              const aluno = listaAlunos.find(a => a.id === e.target.value);
              setAgendamentoForm({
                ...agendamentoForm,
                aluno_id: e.target.value,
                _nomeAluno: aluno?.nome_completo?.split(' ')[0] || '',
              });
            }}
          >
            <option value="">Selecione o aluno...</option>
            {listaAlunos.map(a => (
              <option key={a.id} value={a.id}>{a.nome_completo}</option>
            ))}
          </Input>
        ) : (
          <div className="space-y-3 bg-warning-soft p-4 rounded-2xl border border-warning/20 animate-in slide-in-from-right-4">
            <Input
              required
              type="text"
              placeholder="Nome do Visitante *"
              value={agendamentoForm.nome_visitante || ''}
              onChange={e => setAgendamentoForm({ ...agendamentoForm, nome_visitante: e.target.value })}
              className="bg-card"
            />
          </div>
        )}

        <Input
          type="date"
          required
          value={agendamentoForm.data_aula}
          onChange={e => setAgendamentoForm({ ...agendamentoForm, data_aula: e.target.value })}
        />

        {/* Feedback de vagas */}
        {verificandoVaga && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <RefreshCw size={12} className="animate-spin" /> Verificando disponibilidade...
          </p>
        )}
        {infoVaga && !verificandoVaga && (
          <div className={`text-xs font-bold p-3 rounded-xl ${infoVaga.podeAgendarLivremente ? 'bg-success-soft text-success' : 'bg-destructive-soft text-destructive'}`}>
            {infoVaga.podeAgendarLivremente
              ? `✅ Vaga disponível (${infoVaga.ocupacaoAtual}/${infoVaga.capacidadeMax})`
              : `⚠️ ${infoVaga.avisoCritico}`}
          </div>
        )}

        <div className="pt-2">
          <Button
            type="submit"
            variant="brand"
            size="lg"
            fullWidth
            loading={savingAgendamento}
            disabled={savingAgendamento}
          >
            <UserCheck size={18} /> Confirmar Agendamento
          </Button>
        </div>
      </form>

      {/* Modal de aviso — cobre turma lotada E restrições de plano */}
      {modalLotacao?.isOpen && (
        <ModalConfirmacao
          aberto={modalLotacao.isOpen}
          titulo={configModal.titulo}
          mensagem={configModal.mensagem}
          textoConfirmar={configModal.textoBotaoConfirmar}
          textoCancelar="Cancelar"
          onConfirm={confirmarAgendamentoLotado}
          onClose={cancelarAgendamentoLotado}
        />
      )}
    </>
  );
}