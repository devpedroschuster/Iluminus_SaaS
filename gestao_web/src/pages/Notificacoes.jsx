import React from 'react';
import { useNotificacoes } from '../hooks/useNotificacoes';
import { Bell, Cake, Package, CheckCircle2, RotateCcw, AlertCircle } from 'lucide-react';
import { TableSkeleton } from '../components/shared/Loading';

export default function Notificacoes() {
  const { ativas, concluidas, loading, marcarComoResolvida, desfazerResolvida } = useNotificacoes();

  if (loading) return <div className="p-8"><TableSkeleton /></div>;

  return (
    <div className="p-8 space-y-8 animate-in fade-in max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-gray-800 flex items-center gap-3">
          <Bell className="text-iluminus-terracota" size={32} /> Central de Notificações
        </h1>
        <p className="text-gray-500">Acompanhe vencimentos e aniversários. Dê o "OK" para limpá-los da lista.</p>
      </div>

      {/* NOTIFICAÇÕES ATIVAS */}
      <div className="space-y-4">
        <h2 className="text-lg font-black text-gray-700 flex items-center gap-2">
          Pendentes <span className="bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full text-xs">{ativas.length}</span>
        </h2>
        
        {ativas.length === 0 ? (
          <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm text-center">
            <CheckCircle2 size={40} className="mx-auto text-green-400 mb-3" />
            <p className="font-bold text-gray-600">Tudo em dia!</p>
            <p className="text-sm text-gray-400">Nenhuma notificação pendente ou atrasada no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ativas.map(notif => {
              const isAtrasado = notif.diasFaltando < 0;
              const isHoje = notif.diasFaltando === 0;
              
              return (
                <div key={notif.idUnico} className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col justify-between transition-all ${isAtrasado ? 'border-red-200' : 'border-gray-100 hover:border-orange-200'}`}>
                  <div className="flex gap-4 items-start mb-4">
                    <div className={`p-3 rounded-2xl ${notif.tipo === 'aniversario' ? 'bg-purple-50 text-purple-600' : 'bg-orange-50 text-orange-600'}`}>
                      {notif.tipo === 'aniversario' ? <Cake size={24} /> : <Package size={24} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800">{notif.aluno.nome_completo}</h3>
                      <p className={`text-sm mt-1 flex items-center gap-1 ${isAtrasado ? 'text-red-500 font-bold' : isHoje ? 'text-orange-500 font-bold' : 'text-gray-500 font-medium'}`}>
                        {isAtrasado && <AlertCircle size={14} />}
                        {notif.tipo === 'aniversario' ? 'Aniversário ' : 'Plano '}
                        {isHoje ? 'HOJE!' : 
                         notif.diasFaltando > 0 ? `vence em ${notif.diasFaltando} dias` : 
                         `vencido há ${Math.abs(notif.diasFaltando)} dias`}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Data oficial: {new Date(notif.dataAlvo + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => marcarComoResolvida(notif.idUnico)}
                    className="w-full bg-green-50 text-green-600 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-100 transition-colors"
                  >
                    <CheckCircle2 size={18} /> Resolvido
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* NOTIFICAÇÕES RESOLVIDAS */}
      {concluidas.length > 0 && (
        <div className="space-y-4 pt-8 border-t border-gray-100">
          <h2 className="text-lg font-black text-gray-400 flex items-center gap-2">
            Resolvidas recentemente
          </h2>
          <div className="space-y-2">
            {concluidas.map(notif => (
              <div key={notif.idUnico} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex items-center justify-between opacity-70 hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                  <div className="text-gray-400">
                     {notif.tipo === 'aniversario' ? <Cake size={18} /> : <Package size={18} />}
                  </div>
                  <div>
                    <span className="font-bold text-gray-600 text-sm">{notif.aluno.nome_completo}</span>
                    <span className="text-xs text-gray-400 ml-2">({notif.tipo === 'aniversario' ? 'Aniversário' : 'Vencimento'})</span>
                  </div>
                </div>
                <button 
                  onClick={() => desfazerResolvida(notif.idUnico)}
                  className="text-xs font-bold text-gray-400 hover:text-iluminus-terracota flex items-center gap-1 transition-colors"
                >
                  <RotateCcw size={14} /> Desfazer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}