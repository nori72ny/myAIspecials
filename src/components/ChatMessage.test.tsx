import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ChatMessage, {
  ThinkingStepIndicator,
  SourceCitationCard,
  FluxImageCard,
  LiveSandbox,
  ChatMessageData,
} from './ChatMessage';

describe('ChatMessage and sub-components', () => {
  it('renders ThinkingStepIndicator and toggles visibility', () => {
    const steps = ['Step 1: Parse prompt', 'Step 2: Retrieve citations'];
    render(<ThinkingStepIndicator steps={steps} />);

    expect(screen.getByText(/思考ステップ \(2 件\)/i)).toBeTruthy();
    expect(screen.queryByTestId('thinking-steps-list')).toBeNull();

    fireEvent.click(screen.getByTestId('thinking-toggle-button'));
    expect(screen.getByTestId('thinking-steps-list')).toBeTruthy();
    expect(screen.getByText('Step 1: Parse prompt')).toBeTruthy();
  });

  it('renders SourceCitationCard with citations', () => {
    const citations = [
      { id: '1', title: 'Doc 1', url: 'https://example.com/1', snippet: 'Snippet 1', domain: 'example.com' },
    ];
    render(<SourceCitationCard citations={citations} />);

    expect(screen.getByTestId('source-citation-card')).toBeTruthy();
    expect(screen.getByText('Doc 1')).toBeTruthy();
    expect(screen.getByText('Snippet 1')).toBeTruthy();
  });

  it('renders FluxImageCard with image URL and metadata', () => {
    const image = {
      url: 'https://example.com/image.png',
      alt: 'Sample Image',
      prompt: 'A futuristic city',
      model: 'Flux.1',
      width: 1024,
      height: 768,
    };
    render(<FluxImageCard image={image} />);

    const img = screen.getByTestId('flux-image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/image.png');
    expect(screen.getByText(/Flux.1 · 1024×768/)).toBeTruthy();
  });

  it('renders LiveSandbox with preview and tab toggling', () => {
    const artifact = {
      title: 'Interactive Web Page',
      language: 'html',
      content: '<h1>Hello Sandbox</h1>',
    };
    render(<LiveSandbox artifact={artifact} />);

    expect(screen.getByTestId('sandbox-preview-iframe')).toBeTruthy();

    fireEvent.click(screen.getByTestId('sandbox-tab-code'));
    expect(screen.getByTestId('sandbox-code-block')).toBeTruthy();
    expect(screen.getByText('<h1>Hello Sandbox</h1>')).toBeTruthy();
  });

  it('renders ChatMessage with all integrated modes inline', () => {
    const message: ChatMessageData = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Here is the integrated response with code, image, and citations:',
      thinkingSteps: ['Analyzing user input', 'Synthesizing output'],
      citations: [{ title: 'Reference 1', url: 'https://ref.com', snippet: 'Ref snippet' }],
      image: { url: 'https://img.com/cat.png', prompt: 'Cute cat' },
      artifact: { title: 'App preview', language: 'html', content: '<button>Click me</button>' },
    };

    render(<ChatMessage message={message} />);

    expect(screen.getByTestId('chat-message-msg-1')).toBeTruthy();
    expect(screen.getByText('Here is the integrated response with code, image, and citations:')).toBeTruthy();
    expect(screen.getByTestId('thinking-step-indicator')).toBeTruthy();
    expect(screen.getByTestId('source-citation-card')).toBeTruthy();
    expect(screen.getByTestId('flux-image-card')).toBeTruthy();
    expect(screen.getByTestId('live-sandbox')).toBeTruthy();
  });
});
