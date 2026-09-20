import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { LabApp } from './lab/LabApp.tsx';

createRoot(document.getElementById('app')!).render(<StrictMode><LabApp /></StrictMode>);
