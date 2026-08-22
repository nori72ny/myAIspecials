import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ORIGIN Personal 2.0 production entrypoint', () => {
  it('ships PersonalEditionApp as the production wrapper for the shared Personal 2.0 UI', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    const personalEdition = readFileSync(
      resolve(process.cwd(), 'src/components/personal/PersonalEditionApp.tsx'),
      'utf8',
    );
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(entrypoint).toContain('./components/personal/PersonalEditionApp');
    expect(entrypoint).toContain('./components/SettingsModal');
    expect(entrypoint).not.toMatch(/from\s+['"]\.\/App['"]/);
    expect(entrypoint).toContain('./hooks/usePersonalSettings');
    expect(entrypoint).not.toContain('./hooks/useAppState');

    expect(personalEdition).toContain("import App from '../../App'");
    expect(personalEdition).toContain('onOpenSettings={onOpenSettings}');
    expect(personalEdition).not.toContain("from './PersonalDashboard'");
    expect(personalEdition).not.toContain("from './UnifiedChat'");

    expect(app).toContain('Personal 2.0');
    expect(app).toContain('origin-core-logo');
    expect(app).toContain('artifact-workspace');
    expect(app).toContain('ArtifactWorkspace');
  });

  it('uses a Japanese-first, dependency-light document boundary', () => {
    const document = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const styles = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const entrypoint = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');

    expect(document).toContain('<html lang="ja">');
    expect(document).toContain('<title>ORIGIN Personal</title>');
    expect(document).not.toContain('Ultimate');
    expect(document).not.toMatch(/img-src[^;]*https/);
    expect(document).not.toContain('fonts.googleapis.com');
    expect(styles).not.toContain('fonts.googleapis.com');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    for (const source of [document, styles, entrypoint]) {
      expect(source).not.toMatch(/manus-runtime|manus\.computer|debug-collector/i);
      expect(source).not.toMatch(/<script[^>]+src=["']https?:\/\//i);
    }
  });

  it('does not mount the legacy dashboard API or Mission Engine', () => {
    const serverComposition = readFileSync(
      resolve(process.cwd(), 'src/server/createOriginApp.ts'),
      'utf8',
    );

    expect(serverComposition).toContain('createOriginChatRouter');
    expect(serverComposition).toContain('createOriginLegacyProviderBoundaryRouter');
    expect(serverComposition).not.toContain('createLegacyRouter');
    expect(serverComposition).not.toContain('initMissionEngine');
    expect(serverComposition).not.toMatch(/app\.use\(\s*["']\/api\/v1["']/);
    expect(serverComposition).not.toMatch(/img-src[^;]*https/);
    expect(serverComposition).not.toContain('fonts.googleapis.com');
  });
});
