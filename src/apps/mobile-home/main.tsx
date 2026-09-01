import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileHome from './MobileHome';
import '../../styles/tailwind.build.css'; // shared Tailwind utilities (see tailwind.config.js)
import './mobile-home.css'; // island-specific CSS (fonts, keyframes)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileHome />
  </React.StrictMode>,
);
