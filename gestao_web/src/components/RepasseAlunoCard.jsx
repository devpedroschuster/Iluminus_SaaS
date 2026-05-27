import { CheckCircle2, Printer } from 'lucide-react';
import { formatarMoeda } from '../lib/utils';

// Mapa de labels para forma de pagamento
const FORMA_LABELS = {
  pix: 'Pix',
  credito: 'Cartão de Crédito',
  debito: 'Cartão de Débito',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
};

// Mapa de labels para tipo de aula
const TIPO_AULA_LABELS = {
  regular: 'Regular',
  experimental: 'Experimental',
  avulsa: 'Avulsa',
  reposicao: 'Reposição',
};

/**
 * RepasseAlunoCard
 *
 * Props:
 *   aluno            – objeto com nome_completo
 *   mensalidade      – objeto com tipo_aula (e opcionalmente data_pagamento, planos.nome)
 *   resultado        – objeto retornado por financeiroService.confirmarPagamento
 *   pagamento        – { valor_pago, forma_pagamento, data_pagamento } (dados do recibo)
 */
export default function RepasseAlunoCard({ aluno, mensalidade, resultado, pagamento }) {
  if (!resultado) return null;

  // Data de pagamento: prefere o campo explícito, cai na data de hoje
  const dataFormatada = (() => {
    const raw = pagamento?.data_pagamento || new Date().toISOString();
    return new Date(raw).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  })();

  const nomeAluno = aluno?.nome_completo || '—';
  const valorPago = pagamento?.valor_pago ?? resultado.valor_total;
  const formaPagamento = pagamento?.forma_pagamento || resultado.forma_pagamento;
  const tipoAula = mensalidade?.tipo_aula;
  const planoNome = mensalidade?.planos?.nome;

  const handlePrint = () => {
    const printArea = document.getElementById('iluminus-recibo');
    if (!printArea) return;

    const win = window.open('', '_blank', 'width=480,height=700');
    win.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Comprovante de Pagamento – Iluminus</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: #fff;
            color: #111;
            padding: 32px;
          }
          .recibo { max-width: 400px; margin: 0 auto; }
          .logo { font-size: 22px; font-weight: 900; color: #ca8a04; letter-spacing: -0.5px; margin-bottom: 4px; }
          .titulo { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 24px; }
          .icone-ok { font-size: 28px; margin-bottom: 12px; }
          .valor-destaque { font-size: 36px; font-weight: 900; margin: 8px 0 24px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          td { padding: 8px 0; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
          td:first-child { color: #6b7280; }
          td:last-child { text-align: right; font-weight: 600; }
          .secao-titulo { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin: 20px 0 8px; }
          .repasse-item { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
          .retencao { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; padding-top: 12px; border-top: 2px solid #111; margin-top: 8px; }
          .aviso { background: #fffbeb; color: #92400e; border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-top: 16px; }
          .rodape { margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center; }
        </style>
      </head>
      <body>
        <div class="recibo">
          <div class="logo">Iluminus</div>
          <div class="titulo">Comprovante de Pagamento</div>
          <div class="icone-ok">✅</div>
          <div class="valor-destaque">${formatarMoeda(valorPago)}</div>
          <table>
            <tr><td>Aluno</td><td>${nomeAluno}</td></tr>
            ${planoNome ? `<tr><td>Plano</td><td>${planoNome}</td></tr>` : ''}
            ${tipoAula ? `<tr><td>Tipo de Aula</td><td>${TIPO_AULA_LABELS[tipoAula] || tipoAula}</td></tr>` : ''}
            <tr><td>Forma de Pagamento</td><td>${FORMA_LABELS[formaPagamento] || formaPagamento || '—'}</td></tr>
            <tr><td>Data / Hora</td><td>${dataFormatada}</td></tr>
          </table>
          ${resultado.itens?.length > 0 ? `
            <div class="secao-titulo">Repasses a Professores</div>
            ${resultado.itens.map(it => `
              <div class="repasse-item">
                <span>${it.professor_nome || 'Professor'}${it.modalidade ? ` (${it.modalidade})` : ''}</span>
                <span>${formatarMoeda(it.valor)}</span>
              </div>
            `).join('')}
          ` : ''}
          <div class="retencao">
            <span>Retenção Casa</span>
            <span>${formatarMoeda(resultado.retencao_casa)}</span>
          </div>
          ${resultado.avisos?.length > 0 ? `
            <div class="aviso">${resultado.avisos.map(a => `⚠ ${a}`).join('<br/>')}</div>
          ` : ''}
          <div class="rodape">Gerado em ${dataFormatada} · Espaço Iluminus</div>
        </div>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  return (
    <div id="iluminus-recibo" className="space-y-4">

      {/* ── Recibo de Pagamento ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-success/30 bg-success-soft p-5">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 size={20} className="text-success shrink-0" />
          <span className="text-sm font-bold text-success uppercase tracking-wide">
            Pagamento Confirmado
          </span>
        </div>

        {/* Valor em destaque */}
        <p className="text-3xl font-black text-foreground mb-4 tabular-nums">
          {formatarMoeda(valorPago)}
        </p>

        {/* Grid de detalhes */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Aluno</dt>
            <dd className="font-semibold text-foreground truncate">{nomeAluno}</dd>
          </div>
          {planoNome && (
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Plano</dt>
              <dd className="font-semibold text-foreground">{planoNome}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Forma de Pagamento</dt>
            <dd className="font-semibold text-foreground capitalize">
              {FORMA_LABELS[formaPagamento] || formaPagamento || '—'}
            </dd>
          </div>
          {tipoAula && (
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Tipo de Aula</dt>
              <dd className="font-semibold text-foreground">
                {TIPO_AULA_LABELS[tipoAula] || tipoAula}
              </dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Data / Hora</dt>
            <dd className="font-semibold text-foreground">{dataFormatada}</dd>
          </div>
        </dl>
      </div>

      {/* ── Repasses a Professores ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Repasses a Professores
        </p>

        {resultado.itens?.length > 0 ? (
          <ul className="space-y-2 mb-3">
            {resultado.itens.map((it, idx) => (
              <li key={idx} className="flex justify-between text-sm">
                <span className="text-foreground">
                  {it.professor_nome || 'Professor'}
                  {it.modalidade ? (
                    <span className="text-muted-foreground"> ({it.modalidade})</span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">{formatarMoeda(it.valor)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground mb-3">Sem repasse a professores.</p>
        )}

        <div className="flex justify-between border-t border-border pt-3 text-sm">
          <span className="font-semibold text-foreground">Retenção Casa</span>
          <span className="font-black tabular-nums text-foreground">
            {formatarMoeda(resultado.retencao_casa)}
          </span>
        </div>
      </div>

      {/* ── Avisos ─────────────────────────────────────────────────────── */}
      {resultado.avisos?.length > 0 && (
        <div className="rounded-xl bg-warning-soft border border-warning/20 p-3 text-xs text-warning-foreground space-y-1">
          {resultado.avisos.map((a, i) => (
            <p key={i}>⚠ {a}</p>
          ))}
        </div>
      )}

      {/* ── Botão Imprimir ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handlePrint}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-muted hover:bg-subtle text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors py-2.5 px-4"
      >
        <Printer size={16} />
        Imprimir / Salvar Comprovante
      </button>
    </div>
  );
}