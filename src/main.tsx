import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsModal from './components/SettingsModal';
import PersonalEditionApp from './components/personal/PersonalEditionApp';
import { useAppState } from './hooks/useAppState';
import './index.css';

function PersonalReleaseRoot() {
  const { settings, updateSettings } = useAppState();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const useLightTheme = settings.selectedTheme === 'light';
    root.classList.toggle('light', useLightTheme);
    root.classList.toggle('dark', !useLightTheme);
  }, [settings.selectedTheme]);

  return (
    <>
      <PersonalEditionApp
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateSettings={updateSettings}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersonalReleaseRoot />
  </StrictMode>,
);
