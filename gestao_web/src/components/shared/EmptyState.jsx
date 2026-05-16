import React from 'react';
import { Search } from 'lucide-react';

export default function EmptyState({ titulo, mensagem }) {
  return (
    <div className="flex flex-col items-center justify-center p-20 text-center animate-in fade-in">
      <div className="bg-primary-soft p-6 rounded-full mb-4 text-primary text-primary transition-colors">
        <Search size={40} />
      </div>
      <h3 className="text-xl font-bold text-gray-800 dark:text-zinc-200 transition-colors">{titulo}</h3>
      <p className="text-gray-400 dark:text-zinc-500 max-w-xs mx-auto mt-2 transition-colors">{mensagem}</p>
    </div>
  );
}