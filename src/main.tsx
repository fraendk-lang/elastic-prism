import { useState } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LandingPage } from './components/LandingPage';
import './index.css';

// NO StrictMode - causes double renders that kill visualizer performance
function Root() {
  const [entered, setEntered] = useState(false);
  return entered ? <App /> : <LandingPage onEnter={() => setEntered(true)} />;
}

createRoot(document.getElementById('root')!).render(<Root />);
