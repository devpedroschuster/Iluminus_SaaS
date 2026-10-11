import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { guardarConvite, descartarConvite } from './lib/conviteInstalacao'

console.log('[main.jsx] v2 carregado ✅');

// Guarda o convite de instalação antes de qualquer tela montar (ILU-81).
window.addEventListener('beforeinstallprompt', guardarConvite);
window.addEventListener('appinstalled', descartarConvite);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[SW] Registrado ✅', reg.scope);
      })
      .catch(err => console.error('[SW] Erro:', err));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)