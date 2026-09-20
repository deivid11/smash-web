import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './play.css';
import './play/scenes.css';
import { registerOfflineWorker } from './sw-register.ts';
import { PlayRoot } from './play/play-app.tsx';

// Cache the app shell + source manifest on first online visit so later visits
// boot offline (https origins only; file:// and plain LAN http skip silently).
void registerOfflineWorker();

const container = document.getElementById('play-app');
if (!container) throw new Error('Missing Play application root.');
createRoot(container).render(<StrictMode><PlayRoot /></StrictMode>);
