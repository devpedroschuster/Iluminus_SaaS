import React, { useState, useEffect, useMemo } from 'react';
import { alunosService } from '../services/alunosService';
import { Gift, CalendarDays, Search, PartyPopper, Cake, MessageCircle } from 'lucide-react';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Surface from '../components/ui/Surface';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function Aniversariantes() {
  const [alunos, setAlunos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [mesSelecionado, setMesSelecionado] = useState(new Date().getMonth());

  useEffect(() => {
    async function fetchAniversariantes() {
      try {
        const data = await alunosService.listarAniversariantes();
        setAlunos(data || []);
      } catch (error) {
        console.error('Erro ao buscar aniversariantes', error);
      } finally {
        setLoading(false);
      }
    }
    fetchAniversariantes();
  }, []);

  const alunosProcessados = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    return alunos.map(aluno => {
      const [ano, mes, dia] = aluno.data_nascimento.split('-');
      const dataNasc = new Date(ano, mes - 1, dia);

      const mesNasc = dataNasc.getMonth();
      const diaNasc = dataNasc.getDate();

      let anosFazendo = hoje.getFullYear() - dataNasc.getFullYear();
      let dataNiverEsteAno = new Date(hoje.getFullYear(), mesNasc, diaNasc);

      let niverJaPassou = false;
      if (dataNiverEsteAno < hoje) {
        niverJaPassou = true;
        dataNiverEsteAno.setFullYear(hoje.getFullYear() + 1);
        anosFazendo += 1;
      }

      const diffTime = dataNiverEsteAno - hoje;
      const diasFaltando = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
        ...aluno,
        mesNasc,
        diaNasc,
        anosFazendo,
        diasFaltando,
        niverJaPassou,
        isHoje: diasFaltando === 0,
        diaMesFormatado: `${String(diaNasc).padStart(2, '0')}/${String(mesNasc + 1).padStart(2, '0')}`,
      };
    }).sort((a, b) => a.diaNasc - b.diaNasc);
  }, [alunos]);

  const aniversariantesFiltrados = alunosProcessados.filter(a => {
    const matchMes = a.mesNasc === mesSelecionado;
    const matchBusca = a.nome_completo.toLowerCase().includes(busca.toLowerCase());
    return matchMes && matchBusca;
  });

  const proximosAniversariantes = [...alunosProcessados]
    .sort((a, b) => a.diasFaltando - b.diasFaltando)
    .slice(0, 5);

  const abrirWhatsApp = (telefone, nome) => {
    if (!telefone) return;
    const numeroLimpo = telefone.replace(/\D/g, '');
    const mensagem = encodeURIComponent(
      `Olá ${nome.split(' ')[0]}! Aqui é do Espaço Iluminus. Passando para te desejar um Feliz Aniversário! 🎉🎈 Que o seu dia seja repleto de alegria e movimento!`
    );
    window.open(`https://wa.me/55${numeroLimpo}?text=${mensagem}`, '_blank');
  };

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* Cabeçalho da página */}
      <div>
        <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
          <PartyPopper className="text-primary" size={32} /> Aniversariantes
        </h1>
        <p className="text-muted-foreground">Acompanhe as datas comemorativas e fidelize seus membros.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* COLUNA ESQUERDA */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gradient-to-br from-primary to-primary/80 rounded-[32px] p-6 text-primary-foreground shadow-brand">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                <Cake size={24} className="text-primary-foreground" />
              </div>
              <h2 className="text-xl font-black">Está Chegando!</h2>
            </div>

            {loading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-white/20 rounded-2xl" />
                ))}
              </div>
            ) : proximosAniversariantes.length === 0 ? (
              <p className="text-primary-foreground/70 font-medium">
                Nenhum aluno com data de nascimento cadastrada.
              </p>
            ) : (
              <div className="space-y-3">
                {proximosAniversariantes.map(aluno => (
                  <div
                    key={aluno.id}
                    className="bg-white/10 border border-white/20 rounded-2xl p-4 flex items-center justify-between backdrop-blur-sm hover:bg-white/20 transition-colors"
                  >
                    <div>
                      <p className="font-bold text-sm truncate max-w-[150px]">{aluno.nome_completo}</p>
                      <p className="text-xs text-primary-foreground/70 flex items-center gap-1 mt-1">
                        <CalendarDays size={12} /> {aluno.diaMesFormatado}
                        <span className="opacity-50">|</span>
                        {aluno.anosFazendo} anos
                      </p>
                    </div>
                    <div className="text-right">
                      {aluno.isHoje ? (
                        <span className="bg-card text-primary font-black text-[10px] uppercase px-2 py-1 rounded-lg animate-pulse">
                          É Hoje!
                        </span>
                      ) : (
                        <span className="font-black text-sm text-primary-foreground/80">
                          {aluno.diasFaltando} {aluno.diasFaltando === 1 ? 'dia' : 'dias'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* COLUNA DIREITA */}
        <Surface
          variant="card"
          padding="none"
          className="lg:col-span-2 overflow-hidden flex flex-col h-[700px]"
        >
          {/* Header com filtros */}
          <div className="p-6 border-b border-border shrink-0">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <h3 className="text-lg font-black text-foreground">Calendário Anual</h3>
              <Input
                leftIcon={<Search size={18} />}
                type="text"
                placeholder="Buscar aluno..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                wrapperClassName="w-full md:w-64"
              />
            </div>

            {/* Abas de mês */}
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2 mt-6">
              {MESES.map((mes, index) => (
                <button
                  key={mes}
                  onClick={() => setMesSelecionado(index)}
                  className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${
                    mesSelecionado === index
                      ? 'bg-primary-soft text-primary shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-subtle hover:text-foreground'
                  }`}
                >
                  {mes}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de aniversariantes */}
          <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-muted/30">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton.Row key={i} className="bg-card rounded-3xl" />)}
              </div>
            ) : aniversariantesFiltrados.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  icon={<Gift size={28} />}
                  title="Nenhum aniversariante"
                  description={`Não encontramos nenhum aluno fazendo aniversário em ${MESES[mesSelecionado]}.`}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {aniversariantesFiltrados.map(aluno => (
                  <div
                    key={aluno.id}
                    className={`bg-card p-5 rounded-3xl border shadow-card flex flex-col justify-between transition-all hover:border-primary/30 hover:shadow-md group ${
                      aluno.isHoje
                        ? 'border-primary ring-4 ring-primary/10'
                        : 'border-border'
                    }`}
                  >
                    {/* Topo do card */}
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-4">
                        {/* Número do dia */}
                        <div
                          className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shrink-0 ${
                            aluno.isHoje
                              ? 'bg-primary text-primary-foreground shadow-brand'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {aluno.diaNasc}
                        </div>

                        <div>
                          <h4
                            className="font-bold text-foreground text-base leading-tight truncate w-[160px]"
                            title={aluno.nome_completo}
                          >
                            {aluno.nome_completo}
                          </h4>
                          <Badge tone="brand" variant="soft" className="mt-1">
                            {aluno.anosFazendo} anos
                          </Badge>
                        </div>
                      </div>

                      {aluno.isHoje && (
                        <PartyPopper size={20} className="text-primary animate-bounce" />
                      )}
                    </div>

                    {/* Rodapé do card */}
                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-border">
                      <span className="text-xs font-medium text-muted-foreground truncate max-w-[120px]">
                        {aluno.planos?.nome || 'Sem plano'}
                      </span>

                      {/* Botão WhatsApp */}
                      <Button
                        variant="success"
                        size="sm"
                        leftIcon={<MessageCircle size={16} />}
                        onClick={() => abrirWhatsApp(aluno.telefone, aluno.nome_completo)}
                        disabled={!aluno.telefone}
                        title={
                          aluno.telefone
                            ? 'Enviar WhatsApp'
                            : 'Aluno sem telefone cadastrado'
                        }
                      >
                        Parabenizar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Surface>

      </div>
    </div>
  );
}