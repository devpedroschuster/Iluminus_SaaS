import React, { useEffect, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/shared/Toast';
import Surface from '../../components/ui/Surface';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';

export default function ProfessorAlunos() {
  const [alunos, setAlunos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    carregarAlunos();
  }, []);

  async function carregarAlunos() {
    setLoading(true);
    try {
      // 1. Descobre o professor_id a partir do auth_id da sessão
      const { data: { session } } = await supabase.auth.getSession();
      const authId = session?.user?.id;
      if (!authId) return;

      const { data: prof } = await supabase
        .from('professores')
        .select('id')
        .eq('auth_id', authId)
        .maybeSingle();

      if (!prof) return;
      const professorId = prof.id;

      // 2. Busca modalidades vinculadas a este professor
      const { data: modalidades } = await supabase
        .from('modalidades')
        .select('id, nome')
        .eq('professor_id', professorId);

      // 3. Também inclui aulas onde o professor está diretamente vinculado
      const { data: aulasDoProf } = await supabase
        .from('agenda')
        .select('modalidade_id')
        .eq('professor_id', professorId);

      const idsModalidadesViaAulas = (aulasDoProf || [])
        .map(a => a.modalidade_id)
        .filter(Boolean);

      const idsModalidades = [
        ...new Set([
          ...(modalidades || []).map(m => m.id),
          ...idsModalidadesViaAulas,
        ]),
      ];

      if (idsModalidades.length === 0) {
        setAlunos([]);
        return;
      }

      // 4. Busca alunos ativos que tenham ao menos uma dessas modalidades
      //    no array modalidades_selecionadas
      const { data: todosAlunos, error } = await supabase
        .from('alunos')
        .select('id, nome_completo, email, telefone, ativo, planos(nome), modalidades_selecionadas')
        .eq('ativo', true)
        .eq('role', 'aluno')
        .order('nome_completo');

      if (error) throw error;

      // Filtra no client-side: aluno deve ter ao menos 1 modalidade do professor
      const alunosFiltrados = (todosAlunos || []).filter(aluno => {
        const mods = aluno.modalidades_selecionadas || [];
        return mods.some(id => idsModalidades.includes(id));
      });

      setAlunos(alunosFiltrados);
    } catch (err) {
      showToast.error('Erro ao carregar alunos.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const alunosFiltrados = alunos.filter(a =>
    !busca ||
    a.nome_completo?.toLowerCase().includes(busca.toLowerCase()) ||
    a.email?.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className="p-8 space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">Meus Alunos</h1>
        <p className="text-muted-foreground font-medium">
          Alunos matriculados nas suas modalidades.
        </p>
      </div>

      <Input
        leftIcon={<Search size={18} />}
        placeholder="Buscar por nome ou e-mail..."
        value={busca}
        onChange={e => setBusca(e.target.value)}
      />

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : alunosFiltrados.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Nenhum aluno encontrado"
          description="Não há alunos matriculados nas suas modalidades ainda."
        />
      ) : (
        <Surface variant="card" padding="none" className="rounded-[32px] overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-muted/50 text-[10px] font-black uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="px-8 py-5">Aluno</th>
                <th className="px-8 py-5">Plano</th>
                <th className="px-8 py-5">Telefone</th>
                <th className="px-8 py-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {alunosFiltrados.map(aluno => (
                <tr key={aluno.id} className="hover:bg-primary-soft/30 transition-colors">
                  <td className="px-8 py-5">
                    <p className="font-bold text-foreground">{aluno.nome_completo}</p>
                    <p className="text-xs text-muted-foreground">{aluno.email}</p>
                  </td>
                  <td className="px-8 py-5 text-sm font-medium text-foreground">
                    {aluno.planos?.nome || '—'}
                  </td>
                  <td className="px-8 py-5 text-sm text-muted-foreground">
                    {aluno.telefone || '—'}
                  </td>
                  <td className="px-8 py-5">
                    <Badge tone="success" variant="soft">Ativo</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}
    </div>
  );
}