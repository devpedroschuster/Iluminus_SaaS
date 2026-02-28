import React from 'react';
import { RefreshCw } from 'lucide-react';

// Spinner simples para botões ou telas inteiras
export function Spinner({ size = 24, className = "text-iluminus-terracota" }) {
  return <RefreshCw className={`animate-spin ${className}`} size={size} />;
}

// Esqueleto para Tabelas (já usamos no Alunos)
export function TableSkeleton() {
  return (
    <div className="w-full animate-pulse space-y-4 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-4">
          <div className="h-12 w-12 bg-gray-100 rounded-full" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 bg-gray-100 rounded w-1/4" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Esqueleto para Cards de Métricas (Dashboard/Financeiro)
export function CardSkeleton() {
  return (
    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm h-[180px] flex flex-col justify-between animate-pulse">
      <div className="flex justify-between">
        <div className="w-12 h-12 bg-gray-100 rounded-2xl" />
        <div className="w-16 h-6 bg-gray-100 rounded-full" />
      </div>
      <div>
        <div className="h-8 w-32 bg-gray-100 rounded-lg mb-2" />
        <div className="h-4 w-20 bg-gray-100 rounded-lg" />
      </div>
    </div>
  );
}

// NOVO: Esqueleto para Gráficos
export function ChartSkeleton() {
  return (
    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm h-[400px] animate-pulse">
      <div className="h-6 w-48 bg-gray-100 rounded-lg mb-8" />
      <div className="flex items-end gap-4 h-[300px] pb-4 border-b border-gray-50">
        {[1,2,3,4,5,6,7].map(i => (
          <div key={i} className="flex-1 bg-gray-100 rounded-t-lg" style={{ height: `${Math.random() * 80 + 20}%` }} />
        ))}
      </div>
    </div>
  );
}