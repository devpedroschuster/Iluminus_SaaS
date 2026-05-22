import { supabase } from '../lib/supabase';

export async function gerarRepassesDaMensalidade(mensalidadeId) {
  const { data, error } = await supabase.functions.invoke('gerar-repasses', {
    body: { mensalidadeId },
  });

  if (error) throw error;

  return data;
}

export async function listarRepassesProfessor(professorId, mesAno) {
  const inicio = `${mesAno}-01`;
  const [ano, mes] = mesAno.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${mesAno}-${String(ultimoDia).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('repasses_lancamentos')
    .select('id, valor, tipo_aula, modalidade, data_referencia, alunos(nome_completo)')
    .eq('professor_id', professorId)
    .gte('data_referencia', inicio)
    .lte('data_referencia', fim)
    .order('data_referencia', { ascending: false });

  if (error) throw error;
  return data;
}