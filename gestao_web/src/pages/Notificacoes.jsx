import React from 'react';
import { useNotificacoes } from '../hooks/useNotificacoes';
import { Bell, Cake, Package, CheckCircle2, RotateCcw, AlertCircle } from 'lucide-react';
import { TableSkeleton } from '../components/shared/Loading';
import Surface from '../components/ui/Surface';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { cn } from '../lib/cn';

export default function Notificacoes() {
  const { ativas, concluidas, loading, marcarComoResolvida, desfazerResolvida } = useNotificacoes();

  if (loading) return <div className="p-8"><TableSkeleton /></div>;

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight flex items-center gap-3">
          <Bell className="text-primary" size={32} />
          Central de Notificações
        </h1>
        <p className="text-muted-foreground font-medium text-sm mt-1">
          Acompanhe vencimentos e aniversários. Dê o "OK" para limpá-los da lista.
        </p>
      </div>

      {/* NOTIFICAÇÕES ATIVAS */}
      <div className="space-y-4">
        <h2 className="text-base font-black text-foreground flex items-center gap-2">
          Pendentes
          <Badge tone="warning" variant="soft">{ativas.length}</Badge>
        </h2>

        {ativas.length === 0 ? (
          <Surface variant="card" padding="xl" className="text-center">
            <CheckCircle2 size={40} className="mx-auto text-success mb-3" />
            <p className="font-black text-foreground">Tudo em dia!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Nenhuma notificação pendente ou atrasada no momento.
            </p>
          </Surface>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ativas.map(notif => {
              const isAtrasado = notif.diasFaltando < 0;
              const isHoje = notif.diasFaltando === 0;
              const isAniversario = notif.tipo === 'aniversario';

              return (
                <Surface
                  key={notif.idUnico}
                  variant="card"
                  padding="lg"
                  className={cn(
                    'flex flex-col justify-between transition-all',
                    isAtrasado
                      ? 'border-destructive/30'
                      : 'hover:border-primary/30'
                  )}
                >
                  <div className="flex gap-4 items-start mb-4">
                    {/* Ícone */}
                    <div className={cn(
                      'p-3 rounded-2xl shrink-0',
                      isAniversario
                        ? 'bg-purple-soft text-purple'
                        : 'bg-primary-soft text-primary'
                    )}>
                      {isAniversario ? <Cake size={24} /> : <Package size={24} />}
                    </div>

                    {/* Conteúdo */}
                    <div className="min-w-0">
                      <h3 className="font-black text-foreground truncate">
                        {notif.aluno.nome_completo}
                      </h3>
                      <p className={cn(
                        'text-sm mt-1 flex items-center gap-1 font-bold',
                        isAtrasado
                          ? 'text-destructive'
                          : isHoje
                            ? 'text-warning'
                            : 'text-muted-foreground'
                      )}>
                        {isAtrasado && <AlertCircle size={14} className="shrink-0" />}
                        {isAniversario ? 'Aniversário ' : 'Plano '}
                        {isHoje
                          ? 'HOJE!'
                          : notif.diasFaltando > 0
                            ? `vence em ${notif.diasFaltando} dias`
                            : `vencido há ${Math.abs(notif.diasFaltando)} dias`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Data oficial:{' '}
                        {new Date(notif.dataAlvo + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="success"
                    size="md"
                    fullWidth
                    leftIcon={<CheckCircle2 size={18} />}
                    onClick={() => marcarComoResolvida(notif.idUnico)}
                  >
                    Resolvido
                  </Button>
                </Surface>
              );
            })}
          </div>
        )}
      </div>

      {concluidas.length > 0 && (
        <div className="space-y-3 pt-8 border-t border-border">
          <h2 className="text-base font-black text-muted-foreground">
            Resolvidas recentemente
          </h2>
          <div className="space-y-2">
            {concluidas.map(notif => (
              <Surface
                key={notif.idUnico}
                variant="muted"
                padding="md"
                className="flex items-center justify-between opacity-60 hover:opacity-100 transition-opacity"
              >
                <div className="flex items-center gap-3">
                  <div className="text-muted-foreground shrink-0">
                    {notif.tipo === 'aniversario' ? <Cake size={18} /> : <Package size={18} />}
                  </div>
                  <div>
                    <span className="font-black text-foreground text-sm">
                      {notif.aluno.nome_completo}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({notif.tipo === 'aniversario' ? 'Aniversário' : 'Vencimento'})
                    </span>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<RotateCcw size={14} />}
                  onClick={() => desfazerResolvida(notif.idUnico)}
                >
                  Desfazer
                </Button>
              </Surface>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}