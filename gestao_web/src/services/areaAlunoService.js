import { supabase } from '../lib/supabase';

// Área do Aluno (ILU-78/79/80): o servidor decide o que pode ser agendado ou
// cancelado e por quê (listar_aulas_aluno / agendar_aula /
// cancelar_meu_agendamento resolvem o aluno pelo login). Aqui só se repassa
// a chamada e a mensagem de recusa do servidor.
function erroDoServidor(error) {
  return new Error(error?.message || 'Não foi possível concluir. Tente novamente.');
}

export const areaAlunoService = {
  async listarAulas() {
    const { data, error } = await supabase.rpc('listar_aulas_aluno');
    if (error) throw erroDoServidor(error);
    return data;
  },

  async agendar(aulaId, data) {
    const { data: resultado, error } = await supabase.rpc('agendar_aula', { p_aula_id: aulaId, p_data: data });
    if (error) throw erroDoServidor(error);
    return resultado;
  },

  async cancelar(aulaId, data) {
    const { data: resultado, error } = await supabase.rpc('cancelar_meu_agendamento', { p_aula_id: aulaId, p_data: data });
    if (error) throw erroDoServidor(error);
    return resultado;
  },
};
