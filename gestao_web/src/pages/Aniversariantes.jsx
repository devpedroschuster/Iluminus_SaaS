import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Gift, CalendarDays, Search, PartyPopper, Cake, MessageCircle, ChevronRight } from 'lucide-react';
import { TableSkeleton } from '../components/shared/Loading';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function Aniversariantes() {
  const [alunos, setAlunos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  
  // Por padrão, o filtro inicia no mês atual
  const [mesSelecionado, setMesSelecionado] = useState(new Date().getMonth());

  useEffect(() => {
    async function fetchAniversariantes() {
      try {
        // Busca alunos que tenham data de nascimento preenchida
        const { data, error } = await supabase
          .from('alunos')
          .select('id, nome_completo, data_nascimento, telefone, planos(nome)')
          .not('data_nascimento', 'is', null);

        if (error) throw error;
        setAlunos(data || []);
      } catch (error) {
        console.error("Erro ao buscar aniversariantes", error);
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
      // Evita problemas de fuso horário quebrando a string YYYY-MM-DD
      const [ano, mes, dia] = aluno.data_nascimento.split('-');
      const dataNasc = new Date(ano, mes - 1, dia);
      
      const mesNasc = dataNasc.getMonth();
      const diaNasc = dataNasc.getDate();
      
      // Calcula a idade que o aluno fará ou fez este ano
      let anosFazendo = hoje.getFullYear() - dataNasc.getFullYear();

      // Monta a data do aniversário DESTE ano
      let dataNiverEsteAno = new Date(hoje.getFullYear(), mesNasc, diaNasc);

      // Descobre se o aniversário já passou este ano
      let niverJaPassou = false;
      if (dataNiverEsteAno < hoje) {
         niverJaPassou = true;
         // Se já passou, o próximo aniversário é ano que vem
         dataNiverEsteAno.setFullYear(hoje.getFullYear() + 1);
         anosFazendo += 1; // A idade que fará no próximo ano
      }

      // Calcula os dias faltando para o próximo aniversário
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
        diaMesFormatado: `${String(diaNasc).padStart(2, '0')}/${String(mesNasc + 1).padStart(2, '0')}`
      };
    }).sort((a, b) => a.diaNasc - b.diaNasc); // Ordena pelo dia do mês
  }, [alunos]);

  // Filtra pelo mês clicado nas abas E pela busca digitada
  const aniversariantesFiltrados = alunosProcessados.filter(a => {
    const matchMes = a.mesNasc === mesSelecionado;
    const matchBusca = a.nome_completo.toLowerCase().includes(busca.toLowerCase());
    return matchMes && matchBusca;
  });

  // Pega os próximos 5 aniversariantes (independente do mês) para o Card de Destaque
  const proximosAniversariantes = [...alunosProcessados]
    .sort((a, b) => a.diasFaltando - b.diasFaltando)
    .slice(0, 5);

  const abrirWhatsApp = (telefone, nome) => {
    if (!telefone) return;
    const numeroLimpo = telefone.replace(/\D/g, '');
    const mensagem = encodeURIComponent(`Olá ${nome.split(' ')[0]}! Aqui é do Espaço Iluminus. Passando para te desejar um Feliz Aniversário! 🎉🎈 Que o seu dia seja repleto de alegria e movimento!`);
    window.open(`https://wa.me/55${numeroLimpo}?text=${mensagem}`, '_blank');
  };

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-gray-800 flex items-center gap-3">
          <PartyPopper className="text-orange-500" size={32}/> Aniversariantes
        </h1>
        <p className="text-gray-500">Acompanhe as datas comemorativas e fidelize seus membros.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* COLUNA ESQUERDA: DESTAQUES (Próximos) */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gradient-to-br from-orange-500 to-iluminus-terracota rounded-[32px] p-6 text-white shadow-lg shadow-orange-200">
             <div className="flex items-center gap-3 mb-6">
                <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                   <Cake size={24} className="text-white"/>
                </div>
                <h2 className="text-xl font-black">Está Chegando!</h2>
             </div>

             {loading ? (
                <div className="animate-pulse space-y-3">
                  {[1,2,3].map(i => <div key={i} className="h-16 bg-white/20 rounded-2xl"></div>)}
                </div>
             ) : proximosAniversariantes.length === 0 ? (
                <p className="text-orange-100 font-medium">Nenhum aluno com data de nascimento cadastrada.</p>
             ) : (
                <div className="space-y-3">
                  {proximosAniversariantes.map(aluno => (
                     <div key={aluno.id} className="bg-white/10 border border-white/20 rounded-2xl p-4 flex items-center justify-between backdrop-blur-sm hover:bg-white/20 transition-colors">
                        <div>
                           <p className="font-bold text-sm truncate max-w-[150px]">{aluno.nome_completo}</p>
                           <p className="text-xs text-orange-100 flex items-center gap-1 mt-1">
                             <CalendarDays size={12}/> {aluno.diaMesFormatado} 
                             <span className="opacity-50">|</span> 
                             {aluno.anosFazendo} anos
                           </p>
                        </div>
                        <div className="text-right">
                           {aluno.isHoje ? (
                              <span className="bg-white text-orange-600 font-black text-[10px] uppercase px-2 py-1 rounded-lg animate-pulse">É Hoje!</span>
                           ) : (
                              <span className="font-black text-sm text-orange-100">
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

        {/* COLUNA DIREITA: FILTROS E LISTA GERAL */}
        <div className="lg:col-span-2 bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[700px]">
           
           <div className="p-6 border-b border-gray-100 shrink-0">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                 <h3 className="text-lg font-black text-gray-800">Calendário Anual</h3>
                 <div className="relative w-full md:w-64">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                       type="text" 
                       placeholder="Buscar aluno..." 
                       value={busca}
                       onChange={e => setBusca(e.target.value)}
                       className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl border border-transparent focus:border-orange-200 outline-none font-medium text-sm"
                    />
                 </div>
              </div>

              {/* ABAS DOS MESES */}
              <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2 mt-6">
                {MESES.map((mes, index) => (
                  <button 
                    key={mes}
                    onClick={() => setMesSelecionado(index)}
                    className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${mesSelecionado === index ? 'bg-orange-100 text-iluminus-terracota shadow-sm' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
                  >
                    {mes}
                  </button>
                ))}
              </div>
           </div>

           <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-gray-50/50">
             {loading ? (
                <TableSkeleton />
             ) : aniversariantesFiltrados.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                   <Gift size={64} className="text-gray-200 mb-4" />
                   <h4 className="text-gray-500 font-bold text-lg">Nenhum aniversariante</h4>
                   <p className="text-gray-400 text-sm mt-1">Não encontramos nenhum aluno fazendo aniversário em {MESES[mesSelecionado]}</p>
                </div>
             ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {aniversariantesFiltrados.map(aluno => (
                      <div key={aluno.id} className={`bg-white p-5 rounded-3xl border shadow-sm flex flex-col justify-between transition-all hover:border-orange-200 hover:shadow-md group ${aluno.isHoje ? 'border-orange-300 ring-4 ring-orange-50' : 'border-gray-100'}`}>
                         
                         <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-4">
                               <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shrink-0 ${aluno.isHoje ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-lg shadow-orange-200' : 'bg-gray-50 text-gray-400'}`}>
                                 {aluno.diaNasc}
                               </div>
                               <div>
                                  <h4 className="font-bold text-gray-800 text-base leading-tight truncate w-[160px]" title={aluno.nome_completo}>{aluno.nome_completo}</h4>
                                  <span className="text-[10px] font-black uppercase tracking-wider text-orange-500 bg-orange-50 px-2 py-0.5 rounded mt-1 inline-block">
                                     {aluno.anosFazendo} anos
                                  </span>
                               </div>
                            </div>
                            {aluno.isHoje && <PartyPopper size={20} className="text-orange-500 animate-bounce" />}
                         </div>

                         <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                            <span className="text-xs font-medium text-gray-400 truncate max-w-[120px]">
                               {aluno.planos?.nome || 'Sem plano'}
                            </span>
                            
                            <button 
                               onClick={() => abrirWhatsApp(aluno.telefone, aluno.nome_completo)}
                               disabled={!aluno.telefone}
                               title={aluno.telefone ? 'Enviar WhatsApp' : 'Aluno sem telefone cadastrado'}
                               className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${aluno.telefone ? 'bg-green-50 text-green-700 hover:bg-green-600 hover:text-white' : 'bg-gray-50 text-gray-300 cursor-not-allowed'}`}
                            >
                               <MessageCircle size={16} /> Parabenizar
                            </button>
                         </div>
                      </div>
                   ))}
                </div>
             )}
           </div>

        </div>
      </div>
    </div>
  );
}