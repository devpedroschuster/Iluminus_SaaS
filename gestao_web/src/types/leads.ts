export interface Lead {
  id: string;
  nome_visitante: string;
  telefone_visitante: string | null;
  data_checkin: string;
  status_conversao: 'pendente' | 'convertido' | 'perdido';
  observacao_lead: string | null;
  agenda: {
    atividade: string
  } | null;
}