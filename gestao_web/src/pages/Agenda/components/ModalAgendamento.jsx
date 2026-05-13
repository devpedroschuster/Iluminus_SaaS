import React from 'react';
import { UserCheck, RefreshCw, MessageCircle } from 'lucide-react';
import { ModalConfirmacao } from '../../../components/shared/Modal';
import Button from '../../../components/ui/Button';
import Input, { Label } from '../../../components/ui/Input';

export default function ModalAgendamento({
  agendamentoForm, setAgendamentoForm, aulas, listaAlunos, handleAgendarAluno,
  savingAgendamento, infoVaga, verificandoVaga,
  modalLotacao, confirmarAgendamentoLotado, cancelarAgendamentoLotado
}) {
  return (
    <>
      <form onSubmit={(e) => handleAgendarAluno(e)} className="space-y-4 pt-2">
        {/* Toggle de Tipo de Aluno */}
        <div className="flex bg-muted p-1 rounded-2xl mb-4 border border-border">
          <button 
            type="button" 
            onClick={() => setAgendamentoForm({...agendamentoForm, tipo: 'cadastrado'})} 
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'cadastrado' ? 'bg-card shadow-sm text-info' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Aluno da Casa
          </button>
          <button 
            type="button" 
            onClick={() => setAgendamentoForm({...agendamentoForm, tipo: 'visitante'})} 
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${agendamentoForm.tipo === 'visitante' ? 'bg-card shadow-sm text-warning' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Aula Experimental
          </button>
        </div>

        <Input 
          as="select" 
          required 
          value={agendamentoForm.aula_id} 
          onChange={e => setAgendamentoForm({...agendamentoForm, aula_id: e.target.value})}
        >
          <option value="">Selecione a aula da grade...</option>
          {aulas.map(aula => <option key={aula.id} value={aula.id}>{aula.atividade} - {aula.eh_recorrente ? aula.dia_semana : 'Evento Único'} às {aula.horario?.slice(0, 5)}</option>)}
        </Input>

        {agendamentoForm.tipo === 'cadastrado' ? (
          <Input 
            as="select" 
            required 
            value={agendamentoForm.aluno_id} 
            onChange={e => setAgendamentoForm({...agendamentoForm, aluno_id: e.target.value})}
          >
            <option value="">Selecione o aluno...</option>
            {listaAlunos.map(a => <option key={a.id} value={a.id}>{a.nome_completo}</option>)}
          </Input>
        ) : (
          <div className="space-y-3 bg-warning-soft p-4 rounded-2xl border border-warning/20 animate-in slide-in-from-right-4">
            <Input
              required 
              type="text" 
              placeholder="Nome do Visitante *"
              value={agendamentoForm.nome_visitante || ''}
              onChange={e => setAgendamentoForm({...agendamentoForm, nome_visitante: e.target.value})}
              className="bg-card"
            />
            <div>
              <Input
                type="text" 
                placeholder="WhatsApp (Opcional)"
                leftIcon={<MessageCircle size={18} />}
                value={agendamentoForm.telefone_visitante || ''}
                onChange={e => setAgendamentoForm({...agendamentoForm, telefone_visitante: e.target.value})}
                className="bg-card"
              />
              <p className="text-[10px] text-warning font-bold ml-1 mt-1">Se não preencher o WhatsApp agora, poderá preencher depois no Painel de Leads.</p>
            </div>
          </div>
        )}

        <div>
          <Label className="mb-1.5 block">Data da Aula</Label>
          <Input 
            type="date" 
            required 
            value={agendamentoForm.data_aula} 
            onChange={e => setAgendamentoForm({...agendamentoForm, data_aula: e.target.value})} 
          />
        </div>

        {/* Feedback de Vagas Integrado aos Tokens */}
        <div className="min-h-[60px] animate-in fade-in">
          {verificandoVaga ? (
            <div className="flex items-center justify-center p-3 text-muted-foreground text-xs font-bold gap-2"><RefreshCw size={14} className="animate-spin"/> Verificando créditos e vagas...</div>
          ) : infoVaga && (
            <div className="flex flex-col md:flex-row gap-2">
              <div className={`flex-1 p-3 rounded-xl border font-bold text-xs flex items-center justify-between ${infoVaga.ocupacaoAtual >= infoVaga.capacidadeMax ? 'bg-destructive-soft text-destructive border-destructive/20' : 'bg-success-soft text-success border-success/20'}`}>
                <span>Lotação da Turma</span>
                <span className="bg-card px-2 py-1 rounded-md shadow-sm">{infoVaga.ocupacaoAtual} de {infoVaga.capacidadeMax}</span>
              </div>
              {agendamentoForm.tipo === 'cadastrado' && agendamentoForm.aluno_id && (
                <div className={`flex-1 p-3 rounded-xl border font-bold text-xs flex flex-col justify-center ${infoVaga.temModalidadeNoPlano === false ? 'bg-destructive-soft text-destructive border-destructive/20' : (infoVaga.usoSemanal >= infoVaga.limiteSemanal && !infoVaga.isLivre ? 'bg-warning-soft text-warning border-warning/20' : 'bg-info-soft text-info border-info/20')}`}>
                  <div className="flex justify-between items-center">
                    <span>Uso na Semana ({infoVaga.modNome})</span>
                    {infoVaga.temModalidadeNoPlano === false ? (
                      <span className="bg-card px-2 py-1 rounded-md shadow-sm text-[10px] uppercase text-destructive">Bloqueado na Área</span>
                    ) : infoVaga.isLivre ? (
                      <span className="bg-card px-2 py-1 rounded-md shadow-sm text-[10px] uppercase">Livre</span>
                    ) : (
                      <span className="bg-card px-2 py-1 rounded-md shadow-sm">{infoVaga.usoSemanal} de {infoVaga.limiteSemanal}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          type="submit"
          variant="brand"
          size="lg"
          fullWidth
          loading={savingAgendamento}
          leftIcon={<UserCheck size={20} />}
        >
          Confirmar Vaga
        </Button>
      </form>
      <ModalConfirmacao
        isOpen={modalLotacao?.isOpen || false}
        onClose={cancelarAgendamentoLotado}
        onConfirm={confirmarAgendamentoLotado}
        titulo="Aviso do Sistema"
        mensagem={modalLotacao?.msg || ''}
        tipo="warning"
      />
    </>
  );
}