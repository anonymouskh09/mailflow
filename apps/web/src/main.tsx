import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui';
import App from './App';
import './index.css';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, err: any) => err?.status !== 401 && err?.status !== 404 && n < 2, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
