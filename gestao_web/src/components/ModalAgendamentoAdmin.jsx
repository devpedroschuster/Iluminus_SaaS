import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import Modal from './shared/Modal';
import * as alunosService from '../services/alunosService';
import { gradeService, agendamentoService } from '../services/agendaService';
// Adicionado Loader2
import { Loader2 } from 'lucide-react';

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

  const inputClass = "w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl pl-4 pr-4 py-3 text-sm focus:ring-2 focus:ring-iluminus-terracota/20 outline-none transition-all text-gray-700 dark:text-zinc-200 placeholder:text-gray-400 dark:placeholder:text-zinc-500";
  const labelClass = "block text-sm font-bold text-gray-700 dark:text-zinc-300 mb-1";

  return (
    <Modal isOpen={isOpen} onClose={onClose} titulo="Agendar Aluno Manualmente">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        
        <div>
          <label className={labelClass}>Aluno</label>
          <select 
            {...register('aluno_id', { required: "Selecione um aluno" })}
            className={inputClass}
          >
            <option value="">Selecione o aluno...</option>
            {alunos.map(aluno => (
              <option key={aluno.id} value={aluno.id}>
                {aluno.nome}
              </option>
            ))}
          </select>
          {errors.aluno_id && <span className="text-red-500 dark:text-red-400 text-xs font-medium mt-1 block">{errors.aluno_id.message}</span>}
        </div>

        <div>
          <label className={labelClass}>Aula</label>
          <select 
            {...register('aula_id', { required: "Selecione uma aula" })}
            className={inputClass}
          >
            <option value="">Selecione a aula...</option>
            {aulas.map(aula => (
              <option key={aula.id} value={aula.id}>
                {aula.nome} - {aula.dias_semana} ({aula.horario_inicio})
              </option>
            ))}
          </select>
          {errors.aula_id && <span className="text-red-500 dark:text-red-400 text-xs font-medium mt-1 block">{errors.aula_id.message}</span>}
        </div>

        <div>
          <label className={labelClass}>Data da Aula</label>
          <input 
            type="date" 
            {...register('data_aula', { required: "A data é obrigatória" })}
            className={inputClass}
          />
          {errors.data_aula && <span className="text-red-500 dark:text-red-400 text-xs font-medium mt-1 block">{errors.data_aula.message}</span>}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button 
            type="button" 
            onClick={onClose}
            className="px-6 py-3 font-bold text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-all"
            disabled={isLoading}
          >
            Cancelar
          </button>
          
          {/* Botão com Feedback Visual Atualizado */}
          <button 
            type="submit" 
            disabled={isLoading}
            className="px-6 py-3 font-bold bg-iluminus-terracota text-white rounded-xl hover:brightness-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <><Loader2 className="animate-spin" size={20} /> Agendando...</> : 'Confirmar Agendamento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}