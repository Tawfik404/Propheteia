import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <SettingsProvider>
          <SocketProvider>
            <App />
          </SocketProvider>
        </SettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
