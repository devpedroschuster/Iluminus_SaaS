export interface Lead {
  id: string;
  nome: string;
  telefone: string | null;
  data_checkin: string;
  status_conversao: 'pendente' | 'convertido' | 'perdido';
  observacao: string | null;
  agenda: {
    atividade: string
  } | null;
}