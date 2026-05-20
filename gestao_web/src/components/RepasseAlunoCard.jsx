import { formatarMoeda } from '../lib/utils';

export default function RepasseAlunoCard({ aluno, mensalidade, resultado }) {
  if (!resultado) return null;
  const formaLabels = {
    pix: 'Pix', credito: 'Crédito', debito: 'Débito',
    dinheiro: 'Dinheiro', transferencia: 'Transferência',
  };

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm">
      <div className="text-sm text-gray-700 mb-3">
        <strong>Aluno:</strong> {aluno?.nome_completo || '-'} {' | '}
        <strong>Tipo:</strong> {mensalidade?.tipo_aula || '-'} {' | '}
        <strong>Total Pago:</strong> {formatarMoeda(resultado.valor_total)} {' | '}
        <strong>Forma:</strong> {formaLabels[resultado.forma_pagamento] || '-'}
      </div>

      <ul className="space-y-1 mb-3">
        {resultado.itens.map((it, idx) => (
          <li key={idx} className="flex justify-between text-sm">
            <span>
              {it.professor_nome || 'Professor'}
              {it.modalidade ? ` (${it.modalidade})` : ''}
            </span>
            <span className="font-medium">{formatarMoeda(it.valor)}</span>
          </li>
        ))}
        {resultado.itens.length === 0 && (
          <li className="text-sm text-gray-500">Sem repasse a professores.</li>
        )}
      </ul>

      <div className="flex justify-between border-t pt-2 text-sm">
        <span className="font-medium">Retenção Casa</span>
        <span className="font-semibold">{formatarMoeda(resultado.retencao_casa)}</span>
      </div>

      {resultado.avisos?.length > 0 && (
        <div className="mt-3 text-xs text-amber-700 bg-amber-50 rounded p-2">
          {resultado.avisos.map((a, i) => <div key={i}>⚠ {a}</div>)}
        </div>
      )}
    </div>
  );
}
