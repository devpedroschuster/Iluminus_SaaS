import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Erro capturado pelo ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-iluminus-fundo flex items-center justify-center p-4 text-center">
          <div className="max-w-md bg-white p-10 rounded-[40px] shadow-2xl border border-orange-100">
            <div className="bg-red-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="text-red-500" size={40} />
            </div>
            <h1 className="text-2xl font-black text-gray-800 mb-4">Ops! Algo deu errado.</h1>
            <p className="text-gray-500 mb-8">
              O sistema encontrou uma instabilidade inesperada. Não se preocupe, seus dados estão seguros.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="bg-iluminus-terracota text-white px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all"
              >
                <RefreshCw size={18} /> Tentar novamente
              </button>
              <button 
                onClick={() => window.location.href = '/dashboard'}
                className="text-gray-500 font-bold py-2 hover:text-gray-800 transition-colors"
              >
                Voltar para o Início
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-8 p-4 bg-gray-50 rounded-xl text-left overflow-auto max-h-40">
                <p className="text-[10px] font-mono text-red-400">{this.state.error?.toString()}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;