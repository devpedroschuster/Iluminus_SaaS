import React, { useEffect, useState } from 'react';
import { Percent, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { comissoesService } from '../../services/comissoesService';
import { formatarMoeda } from '../../lib/utils';
import { showToast } from '../../components/shared/Toast';
import Surface from '../../components/ui/Surface';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';

export default function ProfessorComissoes() {
  const hoje = new Date();
  const [mesAno, setMesAno] = useState(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  );
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    carregarComissoes();
  }, [mesAno]);

  async function carregarComissoes() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authId = session?.user?.id;
      if (!authId) return;

      const { data: prof } = await supabase
        .from('professores')
        .select('id')
        .eq('auth_id', authId)
        .maybeSingle();

      if (!prof) return;

      const resultado = await comissoesService.buscarDetalhes(prof.id, mesAno);
      setDados(resultado);
    } catch (err) {
      showToast.error('Erro ao carregar comissões.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function navegarMes(delta) {
    const [ano, mes] = mesAno.split('-').map(Number);
    const novaData = new Date(ano, mes - 1 + delta, 1);
    setMesAno(
      `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, '0')}`
    );
  }

  const mesLabel = format(new Date(mesAno + '-15'), 'MMMM yyyy', { locale: ptBR });

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">Minhas Comissões</h1>
          <p className="text-muted-foreground font-medium">Seus lançamentos de repasse por período.</p>
        </div>
        {/* Navegação de mês */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navegarMes(-1)}
            className="p-2 rounded-xl bg-muted text-muted-foreground hover:bg-subtle transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="font-black text-foreground capitalize w-36 text-center">{mesLabel}</span>
          <button
            onClick={() => navegarMes(1)}
            className="p-2 rounded-xl bg-muted text-muted-foreground hover:bg-subtle transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !dados || dados.lancamentos.length === 0 ? (
        <EmptyState
          icon={<Percent size={28} />}
          title="Sem lançamentos"
          description={`Nenhuma comissão registrada em ${mesLabel}.`}
        />
      ) : (
        <>
          {/* Card de resumo */}
          <Surface variant="card" padding="xl" className="rounded-[32px]">
            <p className="text-xs font-black text-muted-foreground uppercase tracking-widest mb-2">
              Total do mês
            </p>
            <p className="text-4xl font-black text-success">
              {formatarMoeda(dados.resumo.total_comissao)}
            </p>
            {dados.fechamento && (
              <Badge tone="success" variant="soft" className="mt-3">
                Mês fechado
              </Badge>
            )}
          </Surface>

          {/* Tabela de lançamentos */}
          <Surface variant="card" padding="none" className="rounded-[32px] overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-8 py-5">Data</th>
                  <th className="px-8 py-5">Aluno</th>
                  <th className="px-8 py-5">Modalidade</th>
                  <th className="px-8 py-5">Tipo</th>
                  <th className="px-8 py-5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dados.lancamentos.map(l => (
                  <tr key={l.id} className="hover:bg-primary-soft/30 transition-colors">
                    <td className="px-8 py-5 text-sm text-muted-foreground">
                      {format(new Date(l.created_at), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-8 py-5 font-bold text-foreground">
                      {l.alunos?.nome_completo || '—'}
                    </td>
                    <td className="px-8 py-5 text-sm text-muted-foreground">
                      {l.modalidade || '—'}
                    </td>
                    <td className="px-8 py-5">
                      <Badge tone="info" variant="soft">{l.tipo_aula}</Badge>
                    </td>
                    <td className="px-8 py-5 text-right font-black text-success">
                      {formatarMoeda(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        </>
      )}
    </div>
  );
}