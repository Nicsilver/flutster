import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const boot = () =>
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

// Dev-only Spotify stub (see devstub.js) — must patch fetch before mount.
if (import.meta.env.DEV && localStorage.getItem('flutster_stub')) {
  import('./devstub.js').then(boot);
} else {
  boot();
}
