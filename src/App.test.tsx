// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./creative/localRasterHistoryV15', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative/localRasterHistoryV15')>();
  return {
    ...actual,
    saveRasterAssetV15: vi.fn(async () => 'saved' as const),
  };
});

vi.mock('./creative/rasterTechnicalCriticV15', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative/rasterTechnicalCriticV15')>();
  return {
    ...actual,
    inspectRasterBlobV15: vi.fn(async () => ({
      version: 'raster-technical-critic-v1' as const,
      passed: true,
      score: 88,
      checks: ['non-empty-alpha', 'non-uniform-content', 'not-fully-black', 'not-fully-white', 'minimum-information-density'],
      issues: [],
      metrics: {
        width: 96,
        height: 96,
        sampledPixels: 9216,
        opaqueCoverage: 1,
        meanLuminance: 0.5,
        luminanceStdDev: 0.2,
        darkClipRatio: 0,
        brightClipRatio: 0,
        edgeEnergy: 0.1,
        histogramEntropy: 0.8,
      },
    })),
  };
});

vi.mock('./creative/rasterReferenceEditClientV15', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative/rasterReferenceEditClientV15')>();
  return {
    ...actual,
    prepareRasterReferenceDataUrlV15: vi.fn(async () => ({
      dataUrl: 'data:image/webp;base64,QUJDRA==',
      mimeType: 'image/webp' as const,
      width: 511,
      height: 511,
      bytes: 4,
    })),
  };
});
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StreamArtifactParser, analyzeArtifactSyntax, applyDirectTouchEdits, App, ArtifactWorkspace, buildRasterGuidedEditPrompt, buildRasterVariationPrompt, completeArtifactClosingTag, createArtifactExportPayload, createArtifactHtmlExportPayload, createArtifactIntegrityManifest, createArtifactVisualDiff, createOfflineArtifactBundle, createOriginStreamRenderBatcher, getOriginSystemPrompt, isDirectCodingWorkspaceRequest, isDirectCreativeWorkspaceRequest, isDirectImageGenerationRequest, isVerifiedRasterProviderId, isExplicitLocalProceduralImageRequest, isVerifiedZeroCostChatPayload, rasterSizeForRequest, sanitizeArtifactPreviewMarkup, searchOriginLocalSnapshot, type ArtifactBlock, type ConversationMessage, type ConversationSession } from './App';

const artifact: ArtifactBlock = {
  id: 'artifact-1', type: 'html', language: 'html', title: 'Safe preview',
  content: '<main><button>Ready</button></main>', isComplete: true,
};

describe('ArtifactWorkspace action bar and sandbox runtime boundary', () => {
  it('accepts only the two explicitly supported free raster provider identities', () => {
    expect(isVerifiedRasterProviderId('cloudflare-workers-ai-free')).toBe(true);
    expect(isVerifiedRasterProviderId('pollinations-zero-cost')).toBe(true);
    expect(isVerifiedRasterProviderId('paid-provider')).toBe(false);
    expect(isVerifiedRasterProviderId(null)).toBe(false);
  });

  afterEach(cleanup);

  it('batches all stream chunks received within one animation frame', () => {
    const renderChunk = vi.fn();
    let scheduledFrame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 17;
    });
    const cancelFrame = vi.fn();
    const batcher = createOriginStreamRenderBatcher(renderChunk, { requestFrame, cancelFrame });

    batcher.enqueue('結論');
    batcher.enqueue('を');
    batcher.enqueue('まとめます。');

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(renderChunk).not.toHaveBeenCalled();
    scheduledFrame?.(16);
    expect(renderChunk).toHaveBeenCalledOnce();
    expect(renderChunk).toHaveBeenCalledWith('結論をまとめます。');
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it('flushes the last streaming frame immediately without losing its content', () => {
    const renderChunk = vi.fn();
    const requestFrame = vi.fn(() => 21);
    const cancelFrame = vi.fn();
    const batcher = createOriginStreamRenderBatcher(renderChunk, { requestFrame, cancelFrame });

    batcher.enqueue('途中');
    batcher.enqueue('と最終チャンク');
    batcher.flush();

    expect(cancelFrame).toHaveBeenCalledWith(21);
    expect(renderChunk).toHaveBeenCalledOnce();
    expect(renderChunk).toHaveBeenCalledWith('途中と最終チャンク');
  });

  it('drops a cancelled streaming frame without revealing unverified content', () => {
    const renderChunk = vi.fn();
    let scheduledFrame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 31;
    });
    const cancelFrame = vi.fn();
    const batcher = createOriginStreamRenderBatcher(renderChunk, { requestFrame, cancelFrame });

    batcher.enqueue('表示してはいけない途中応答');
    batcher.cancel();
    scheduledFrame?.(16);
    batcher.enqueue('中止後の応答');
    batcher.flush();

    expect(cancelFrame).toHaveBeenCalledWith(31);
    expect(renderChunk).not.toHaveBeenCalled();
  });

  it('keeps edit and save as primary actions, and groups advanced actions under details', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);