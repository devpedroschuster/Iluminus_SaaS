import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Input, { Label } from './ui/Input';
import * as alunosService from '../services/alunosService';
import { gradeService, agendamentoService } from '../services/agendaService';

export default function ModalAgendamentoAdmin({ isOpen, onClose, onSucesso }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm();
  const [alunos, setAlunos] = useState([]);
  const [aulas, setAulas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      carregarDados();
    }
  }, [isOpen]);

  const carregarDados = async () => {
    try {
      const alunosData = await alunosService.buscarAlunosAtivos(); 
      const aulasData = await gradeService.listarGrade();      
      setAlunos(alunosData || []);
      setAulas(aulasData || []);
    } catch (error) {
      console.error("Erro ao carregar dados para o agendamento:", error);
    }
  };

  const onSubmit = async (data) => {
    setIsLoading(true);
    try {
      await agendamentoService.agendarAulaAdmin({
        aluno_id: data.aluno_id,
        aula_id: data.aula_id,
        data_aula: data.data_aula
      });
      reset();
      onSucesso();
      onClose();
    } catch (error) {
      console.error("Erro ao agendar:", error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal aberto={isOpen} fechar={onClose} title="Agendar Aula Administrativamente" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-2">
        
        <div>
          <Label className="block mb-1.5">Aluno</Label>
          <Input 
            as="select" 
            {...register('aluno_id', { required: "O aluno é obrigatório" })}
          >
            <option value="">Selecione um aluno...</option>
            {alunos.map(aluno => (
              <option key={aluno.id} value={aluno.id}>{aluno.nome_completo}</option>
            ))}
          </Input>
          {errors.aluno_id && (
            <span className="text-destructive text-xs font-medium mt-1 block">
              {errors.aluno_id.message}
            </span>
          )}
        </div>

        <div>
          <Label className="block mb-1.5">Aula / Turma</Label>
          <Input 
            as="select" 
            {...register('aula_id', { required: "A aula é obrigatória" })}
          >
            <option value="">Selecione uma aula...</option>
            {aulas.map(aula => (
              <option key={aula.id} value={aula.id}>
                {aula.atividade} ({aula.dia_semana} - {aula.horario})
              </option>
            ))}
          </Input>
          {errors.aula_id && (
            <span className="text-destructive text-xs font-medium mt-1 block">
              {errors.aula_id.message}
            </span>
          )}
        </div>

        <div>
          <Label className="block mb-1.5">Data da Aula</Label>
          <Input 
            type="date" 
            {...register('data_aula', { required: "A data é obrigatória" })}
          />
          {errors.data_aula && (
            <span className="text-destructive text-xs font-medium mt-1 block">
              {errors.data_aula.message}
            </span>
          )}
        </div>

        <Modal.Footer>
          <Button 
            type="button" 
            variant="ghost" 
            onClick={onClose}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          
          <Button 
            type="submit" 
            variant="brand" 
            loading={isLoading}
          >
            {isLoading ? 'Agendando...' : 'Agendar Aula'}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}