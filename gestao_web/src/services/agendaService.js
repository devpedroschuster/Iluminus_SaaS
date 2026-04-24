import { gradeService } from './gradeService';
import { agendamentoService } from './agendamentoService';
import { leadsService } from './leadsService';

export const agendaService = {
  ...gradeService,
  ...agendamentoService,
  ...leadsService
};