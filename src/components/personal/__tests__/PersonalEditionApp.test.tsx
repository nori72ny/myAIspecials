import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

const appProps = vi.fn();

vi.mock('../../../App', () => ({
  default: (props: Record<string, unknown>) => {
    appProps(props);
    return <div data-testid="mock-origin-app">ORIGIN</div>;
  },
}));

afterEach(() => vi.clearAllMocks());

describe('PersonalEditionApp production wrapper', () => {
  it('mounts the shared App with the Personal settings boundary', () => {
    const onOpenSettings = vi.fn();
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} onOpenSettings={onOpenSettings} />);

    expect(appProps).toHaveBeenCalledOnce();
    const props = appProps.mock.calls[0][0];
    expect(props.onOpenSettings).toBe(onOpenSettings);
    expect(props.language).toBe(DEFAULT_PERSONAL_SETTINGS.language);
    expect(props.designTheme).toBe(DEFAULT_PERSONAL_SETTINGS.designTheme);
    expect(props.messages).toEqual([]);
    expect(props.sessions).toEqual([]);
    expect(props.resetSignal).toBe(0);
  });

  it('keeps the production shell independent from parent-controlled initial messages', () => {
    render(
      <PersonalEditionApp
        settings={DEFAULT_PERSONAL_SETTINGS}
        messages={[{ id: 'u-1', role: 'user', content: '既存の相談' }]}
        sessions={[{ id: 's-1', title: '既存', createdAt: 1, messages: [] }]}
      />,
    );

    const props = appProps.mock.calls[0][0];
    expect(props.messages).toEqual([]);
    expect(props.sessions).toEqual([]);
  });

  it('renders the shared ORIGIN application surface', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);
    expect(document.querySelector('[data-testid="mock-origin-app"]')).toHaveTextContent('ORIGIN');
  });
});
