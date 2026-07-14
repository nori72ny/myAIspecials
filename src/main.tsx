import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import SettingsEventBridge from './components/SettingsEventBridge';
import './index.css';

// XSS Mitigation: Initialize Trusted Types policy
if (typeof window !== "undefined" && (window as any).trustedTypes && (window as any).trustedTypes.createPolicy) {
  try {
    (window as any).trustedTypes.createPolicy("default", {
      createHTML: (html: string) => html,
      createScriptURL: (url: string) => url,
      createScript: (script: string) => script,
    });
    console.log("🔒 Trusted Types security policy active.");
  } catch (e) {
    console.warn("Trusted Types policy initialization bypassed:", e);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <SettingsEventBridge />
  </StrictMode>,
);
