import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Input from '../../../components/ui/Input';
import { filtrarAlunosPorNome } from '../../../lib/buscaAlunoAgenda';

// Busca de aluno na Agenda: campo com sugestões; escolher abre o painel da aluna.
export default function BuscaAlunoAgenda({ alunos, onSelecionar }) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);

  const sugestoes = useMemo(() => filtrarAlunosPorNome(alunos, termo), [alunos, termo]);
  const mostrar = aberto && sugestoes.length > 0;

  function escolher(aluno) {
    onSelecionar(aluno);
    setTermo('');
    setAberto(false);
    setAtivo(0);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setAberto(false);
      return;
    }
    if (!mostrar) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((i) => Math.min(i + 1, sugestoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      escolher(sugestoes[ativo] ?? sugestoes[0]);
    }
  }

  return (
    <div className="relative w-full md:w-72">
      <Input
        type="search"
        placeholder="Buscar aluna na agenda..."
        aria-label="Buscar aluna na agenda"
        leftIcon={<Search size={18} />}
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value);
          setAberto(true);
          setAtivo(0);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={mostrar}
        aria-controls="busca-aluno-agenda-lista"
      />
      {mostrar && (
        <ul
          id="busca-aluno-agenda-lista"
          role="listbox"
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        >
          {sugestoes.map((aluno, i) => (
            <li
              key={aluno.id}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(aluno);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer px-4 py-2.5 text-sm font-medium text-foreground ${i === ativo ? 'bg-muted' : ''}`}
            >
              {aluno.nome_completo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
