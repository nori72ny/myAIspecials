import React from 'react';
import App from '../../App';
import type { Settings } from '../../types';

type PersonalEditionAppProps = {
  onSwitchToEnterprise?: () => void;
  settings?: Settings;
  onOpenSettings?: () => void;
};

/**
 * Production entry surface for ORIGIN Personal.
 *
 * The Personal 2.0 interface lives in `src/App.tsx`; composing it here keeps
 * the production entrypoint and the standalone application implementation in
 * lockstep while preserving the settings modal owned by `src/main.tsx`.
 */
const PersonalEditionApp = React.memo(function PersonalEditionApp({
  onOpenSettings,
}: PersonalEditionAppProps) {
  return <App onOpenSettings={onOpenSettings} />;
});

export default PersonalEditionApp;
