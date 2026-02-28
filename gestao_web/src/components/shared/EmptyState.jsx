import React from 'react';
import { Search } from 'lucide-react';

export default function EmptyState({ titulo, mensagem }) {
  return (
    <div className="flex flex-col items-center justify-center p-20 text-center">
      <div className="bg-orange-50 p-6 rounded-full mb-4 text-iluminus-terracota">
        <Search size={40} />
      </div>
      <h3 className="text-xl font-bold text-gray-800">{titulo}</h3>
      <p className="text-gray-400 max-w-xs mx-auto mt-2">{mensagem}</p>
    </div>
  );
}