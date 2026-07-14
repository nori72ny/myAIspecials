import { useCallback, useEffect, useState } from "react";
import { useAppState } from "../hooks/useAppState";
import SettingsModal from "./SettingsModal";

export default function SettingsEventBridge() {
  const [isOpen, setIsOpen] = useState(false);
  const { settings, updateSettings } = useAppState();

  const closeSettings = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const openSettings = () => setIsOpen(true);
    window.addEventListener("openSettings", openSettings);
    return () => window.removeEventListener("openSettings", openSettings);
  }, []);

  return (
    <SettingsModal
      isOpen={isOpen}
      onClose={closeSettings}
      settings={settings}
      updateSettings={updateSettings}
    />
  );
}
