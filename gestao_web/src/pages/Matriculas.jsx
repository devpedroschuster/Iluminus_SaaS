import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ClipboardList, History, RefreshCw, WifiOff } from 'lucide-react';
import { alunosService } from '../services/alunosService';
import { formatarData } from '../lib/utils';
import { estadoListaMatriculas } from '../lib/matriculas';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Surface from '../components/ui/Surface';

// ILU-120: lista das matrículas recentes (nome + quando fechou), para o
// estúdio acompanhar se já mandou as informações para cada aluno novo. A
// conferência em si fica fora do sistema — por isso a página não tem
// checagens nem marcações.
const JANELA_DIAS = 30;

export default function Matriculas() {
  const [dias, setDias] = useState(JANELA_DIAS);

  // Matrícula nova aparece ao abrir a página porque a consulta usa o staleTime
  // padrão (0) e busca de novo a cada montagem — não adicionar staleTime aqui
  // sem garantir que o cadastro invalide esta chave. O prefixo 'alunos' faz
  // invalidações de ['alunos'] também atualizarem a lista.
  const {
    data: matriculas = [], isError, isPending, isPlaceholderData, isFetching, fetchStatus, refetch,
  } = useQuery({
    queryKey: ['alunos', 'matriculas-recentes', dias],
    queryFn: () => alunosService.listarMatriculasRecentes({ dias }),
    placeholderData: keepPreviousData,
  });

  const estado = estadoListaMatriculas({
    isError, isPending, isPlaceholderData, fetchStatus, total: matriculas.length,
  });

  const botaoMaisAntigas = (
    <Button
      variant="outline"
      size="sm"
      leftIcon={<History size={16} />}
      onClick={() => setDias((d) => d + JANELA_DIAS)}
      disabled={isFetching}
    >
      Ver mais antigas
    </Button>
  );

  let conteudo;
  if (estado === 'carregando') {
    conteudo = (
      <div className="p-6 space-y-3">
        {[1, 2, 3, 4].map((i) => <Skeleton.Row key={i} />)}
      </div>
    );
  } else if (estado === 'sem-conexao') {
    conteudo = (
      <div className="p-6">
        <EmptyState
          icon={<WifiOff size={28} />}
          title="Sem conexão com a internet."
          description="A lista aparece sozinha assim que a conexão voltar."
        />
      </div>
    );
  } else if (estado === 'erro') {
    conteudo = (
      <div className="p-6">
        <EmptyState
          icon={<RefreshCw size={28} />}
          title="Não foi possível carregar as matrículas."
          description="Verifique a conexão e tente de novo."
          action={(
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              Tentar novamente
            </Button>
          )}
        />
      </div>
    );
  } else if (estado === 'vazio') {
    conteudo = (
      <div className="p-6">
        <EmptyState
          icon={<ClipboardList size={28} />}
          title={`Nenhuma matrícula nos últimos ${dias} dias`}
          description="Use “Ver mais antigas” para olhar um período maior."
          action={botaoMaisAntigas}
        />
      </div>
    );
  } else {
    conteudo = (
      <>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-4 md:px-6 py-3">Aluno</th>
              <th scope="col" className="px-4 md:px-6 py-3 text-right whitespace-nowrap">Fechou em</th>
            </tr>
          </thead>
          <tbody>
            {matriculas.map((aluno) => (
              <tr key={aluno.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                <td className="px-4 md:px-6 py-3">
                  <Link
                    to={`/alunos/${aluno.id}`}
                    className="font-bold text-foreground hover:text-primary hover:underline break-words"
                  >
                    {aluno.nome_completo || 'Sem nome'}
                  </Link>
                </td>
                <td className="px-4 md:px-6 py-3 text-right text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatarData(aluno.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-4 md:p-6 flex justify-center border-t border-border">
          {botaoMaisAntigas}
        </div>
      </>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
          <ClipboardList className="text-primary" size={32} /> Matrículas
        </h1>
        <p className="text-muted-foreground">últimos {dias} dias</p>
      </div>

      <Surface variant="card" padding="none" className="overflow-hidden">
        {conteudo}
      </Surface>
    </div>
  );
}
