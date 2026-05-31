import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { MathfieldElement } from 'mathlive';

// Configure MathLive global asset directories 
// We point to unpkg CDN because .vite/deps doesn't package the fonts correctly out of the box in this setup.
if (typeof MathfieldElement !== 'undefined') {
  MathfieldElement.fontsDirectory = 'https://unpkg.com/mathlive@0.109.2/fonts';
  MathfieldElement.soundsDirectory = 'https://unpkg.com/mathlive@0.109.2/sounds';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
