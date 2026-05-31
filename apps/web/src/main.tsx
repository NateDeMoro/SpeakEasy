import './theme/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { ThemeToggle } from './theme/ThemeToggle.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
    <ThemeToggle />
  </StrictMode>,
);
