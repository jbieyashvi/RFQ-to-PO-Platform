import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from '@/context/AppContext';
import App from './App';
import './index.css';

// Vite injects import.meta.env.BASE_URL from `base` in vite.config.ts.
// Prod (GitHub Pages): "/RFQ-to-PO-Platform/" -> basename "/RFQ-to-PO-Platform".
// Dev: "/" -> basename "/".
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
