import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './viewer.css';
import { ViewerApp } from './viewer/ViewerApp.tsx';

const server = document.querySelector('meta[name="smash-source"]')?.getAttribute('content') === 'server'
  // Client-disc hosts serve no assets: keep the local file picker, exactly like a static build.
  && !document.querySelector('meta[name="smash-disc"][content="client"]');
createRoot(document.getElementById('viewer-app')!).render(<StrictMode><ViewerApp server={server} /></StrictMode>);
