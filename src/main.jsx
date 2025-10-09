import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { BrowserRouter } from 'react-router-dom';
import ShopProvider from './context/ShopContext';

// 🚫 Block accidental ngrok usage at runtime
if (window.location.hostname.includes("ngrok")) {
  window.location.replace("https://tsc2025.netlify.app");
}

ReactDOM.createRoot(document.getElementById('root')).render(
  
  <BrowserRouter>
    <ShopProvider> 
      <App />
    </ShopProvider>
  </BrowserRouter>
);