import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import Modal from './shared/Modal';
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
      alert("Erro ao realizar agendamento. Verifique se o aluno já está agendado ou se há vagas.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agendar Aluno Manualmente">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        
        {/* Seleção de Aluno */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Aluno</label>
          <select 
            {...register('aluno_id', { required: "Selecione um aluno" })}
            className="w-full rounded-md border border-gray-300 p-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Selecione o aluno...</option>
            {alunos.map(aluno => (
              <option key={aluno.id} value={aluno.id}>
                {aluno.nome}
              </option>
            ))}
          </select>
          {errors.aluno_id && <span className="text-red-500 text-xs">{errors.aluno_id.message}</span>}
        </div>

        {/* Seleção de Aula */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Aula</label>
          <select 
            {...register('aula_id', { required: "Selecione uma aula" })}
            className="w-full rounded-md border border-gray-300 p-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Selecione a aula...</option>
            {aulas.map(aula => (
              <option key={aula.id} value={aula.id}>
                {aula.nome} - {aula.dias_semana} ({aula.horario_inicio})
              </option>
            ))}
          </select>
          {errors.aula_id && <span className="text-red-500 text-xs">{errors.aula_id.message}</span>}
        </div>

        {/* Seleção de Data */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Data da Aula</label>
          <input 
            type="date" 
            {...register('data_aula', { required: "A data é obrigatória" })}
            className="w-full rounded-md border border-gray-300 p-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {errors.data_aula && <span className="text-red-500 text-xs">{errors.data_aula.message}</span>}
        </div>

        {/* Botões de Ação */}
        <div className="flex justify-end gap-3 mt-6">
          <button 
            type="button" 
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            disabled={isLoading}
          >
            Cancelar
          </button>
          <button 
            type="submit" 
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Agendando...' : 'Confirmar Agendamento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}