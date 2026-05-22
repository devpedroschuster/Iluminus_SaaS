import React, { useState } from 'react';
import { Calendar, DownloadCloud, AlertCircle, CheckCircle } from 'lucide-react';
import { feriadosService } from '../services/feriadosService';
import { showToast } from '../components/shared/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Surface from '../components/ui/Surface';

export default function ConfiguracoesFeriados() {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [feriadosImportados, setFeriadosImportados] = useState([]);

  const importarDaBrasilAPI = async () => {
    setLoading(true);
    try {
      const feriadosInseridos = await feriadosService.importarFeriadosNacionais(ano);
      setFeriadosImportados(feriadosInseridos);
      showToast.success(`${feriadosInseridos.length} feriados nacionais de ${ano} importados para a agenda!`);
    } catch (error) {
      console.error(error);
      showToast.error('Não foi possível importar os feriados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8 animate-in fade-in">

      {/* Cabeçalho */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
          <Calendar className="text-primary" />
          Calendário e Feriados
        </h1>
        <p className="text-muted-foreground font-medium">
          Automatize os bloqueios da agenda importando os feriados nacionais.
        </p>
      </div>

      {/* Card principal */}
      <Surface variant="card" padding="xl" className="flex flex-col md:flex-row items-center gap-8">

        {/* Coluna esquerda */}
        <div className="flex-1 space-y-4">
          <h2 className="text-lg font-bold text-foreground">
            Importação Automática (Brasil API)
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Puxe automaticamente todos os feriados nacionais de um ano específico.
            Feriados locais (como 20 de Setembro) devem continuar sendo adicionados
            manualmente pelo botão &quot;Bloqueios&quot; na Agenda.
          </p>

          <div className="flex items-center gap-4 pt-4">
            <Input
              as="select"
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              className="w-32 font-bold"
            >
              {[2024, 2025, 2026, 2027, 2028].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Input>

            <Button
              variant="brand"
              size="lg"
              onClick={importarDaBrasilAPI}
              loading={loading}
              leftIcon={<DownloadCloud size={20} />}
            >
              {loading ? 'Buscando...' : `Importar Feriados de ${ano}`}
            </Button>
          </div>
        </div>

        {/* Coluna direita */}
        <div className="w-full md:w-1/3 bg-primary-soft rounded-3xl p-6 border border-primary/20">
          <div className="flex items-center gap-2 text-foreground font-black mb-2">
            <AlertCircle size={20} className="text-primary" />
            Como funciona?
          </div>
          <p className="text-sm text-foreground/70 font-medium">
            A importação é inteligente e ignora datas duplicadas. Você pode apertar
            o botão quantas vezes quiser sem medo de criar feriados repetidos na agenda.
          </p>
        </div>
      </Surface>

      {/* Resultado da importação */}
      {feriadosImportados.length > 0 && (
        <Surface
          variant="card"
          padding="none"
          className="mt-8 overflow-hidden animate-in slide-in-from-bottom-4"
        >
          {/* Cabeçalho da tabela */}
          <div className="px-6 py-4 border-b border-border bg-success-soft flex items-center gap-2 text-success font-bold">
            <CheckCircle size={20} />
            Bloqueios inseridos na agenda com sucesso:
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <tbody className="divide-y divide-border">
                {feriadosImportados.map((f, i) => (
                  <tr key={i} className="hover:bg-muted/50 transition-colors">
                    <td className="p-4 pl-6 font-bold text-foreground w-32">
                      {new Date(f.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-4 font-medium text-muted-foreground">
                      {f.descricao}
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <span className="bg-muted text-muted-foreground text-[10px] font-black uppercase px-3 py-1 rounded-full border border-border">
                        Bloqueio Nacional
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}