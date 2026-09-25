import type { VisualArtifactRequestV15, VisualKindV15, VisualLayoutV15, VisualPresetV15 } from './visualArtifactV15.js';

export const VISUAL_TASKS_V15 = ['generate', 'edit', 'inpaint', 'outpaint', 'variation', 'composite'] as const;
export type VisualTaskV15 = (typeof VISUAL_TASKS_V15)[number];

export type VisualHierarchyItemV15 = {
  role: 'hero' | 'headline' | 'supporting-copy' | 'brand' | 'cta' | 'background';
  priority: number;
};

export type VisualRegionV15 = {
  id: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  purpose: string;
};

export type ChangePreserveMapV15 = {
  change: readonly string[];
  preserve: readonly string[];
};

export type VisualQualityRubricV15 = {
  promptAdherence: number;
  composition: number;
  typography: number;
  layout: number;
  brandConsistency: number;
  accessibility: number;
  artifactSafety: number;
};

export type VisualProviderCapabilityV15 =
  | 'vector'
  | 'raster'
  | 'edit'
  | 'inpaint'
  | 'outpaint'
  | 'variation'
  | 'reference-image'
  | 'ocr-aware'
  | 'identity-preservation';

export type VisualProviderDescriptorV15 = {
  id: string;
  label: string;
  capabilities: readonly VisualProviderCapabilityV15[];
  available: boolean;
  verifiedZeroCost: boolean;
  paidFallback: false;
  externalNetwork: boolean;
};

export type VisualBrainPlanV15 = {
  version: 'visual-brain-v1';
  task: VisualTaskV15;
  purpose: string;
  audience: string;
  platform: string;
  preset: VisualPresetV15;
  kind: VisualKindV15;
  style: {
    direction: string;
    density: 'low' | 'medium' | 'high';
    visualNoise: 'restrained' | 'balanced';
    contrast: 'controlled' | 'strong';
  };
  composition: {
    principle: 'editorial-grid' | 'minimal-center' | 'split-grid';
    safeMarginPct: number;
    regions: readonly VisualRegionV15[];
    hierarchy: readonly VisualHierarchyItemV15[];
  };
  typography: {
    strategy: 'deterministic-overlay';
    maxTitleLines: number;
    maxBodyLines: number;
    preserveExactText: true;
  };
  lighting: {
    mode: 'graphic-flat';
    direction: 'n/a';
  };
  camera: {
    mode: 'n/a';
  };
  changePreserve: ChangePreserveMapV15;
  promptCompiler: {
    universalVisualSpec: string;
    avoid: readonly string[];
  };
  criticRubric: VisualQualityRubricV15;
  providerPolicy: {
    requiredCapabilities: readonly VisualProviderCapabilityV15[];
    candidates: readonly VisualProviderDescriptorV15[];
    selectedProviderId: string | null;
    failClosedReason: string | null;
  };
  iterationPolicy: {
    maxIterations: 3;
    bestOfN: 1;
    repairOnlyWhenBelow: number;
  };
};

const PROVIDERS: readonly VisualProviderDescriptorV15[] = [
  {
    id: 'origin-local-svg',
    label: 'ORIGIN deterministic local SVG',
    capabilities: ['vector', 'ocr-aware'],
    available: true,
    verifiedZeroCost: true,
    paidFallback: false,
    externalNetwork: false,
  },
];

function purposeFor(kind: VisualKindV15): string {
  if (kind === 'poster') return 'attention-and-message';
  if (kind === 'info-card') return 'structured-information';
  return 'social-communication';
}

function platformFor(preset: VisualPresetV15): string {
  if (preset === 'story') return 'vertical-mobile-story';
  if (preset === 'portrait') return 'mobile-feed';
  if (preset === 'landscape') return 'web-social-landscape';
  return 'square-social';
}

function compositionFor(layout: VisualLayoutV15): VisualBrainPlanV15['composition'] {
  if (layout === 'split') {
    return {
      principle: 'split-grid',
      safeMarginPct: 7,
      regions: [
        { id: 'brand-rail', xPct: 0, yPct: 0, widthPct: 26, heightPct: 100, purpose: 'brand/accent zone' },
        { id: 'content', xPct: 34, yPct: 16, widthPct: 58, heightPct: 68, purpose: 'headline and supporting content' },
      ],
      hierarchy: [
        { role: 'headline', priority: 1 },
        { role: 'supporting-copy', priority: 2 },
        { role: 'brand', priority: 3 },
        { role: 'background', priority: 4 },
      ],
    };
  }
  if (layout === 'minimal') {
    return {
      principle: 'minimal-center',
      safeMarginPct: 8,
      regions: [
        { id: 'content', xPct: 8, yPct: 22, widthPct: 84, heightPct: 58, purpose: 'quiet primary message' },
      ],
      hierarchy: [
        { role: 'headline', priority: 1 },
        { role: 'supporting-copy', priority: 2 },
        { role: 'background', priority: 3 },
      ],
    };
  }
  return {
    principle: 'editorial-grid',
    safeMarginPct: 7,
    regions: [
      { id: 'accent', xPct: 7, yPct: 7, widthPct: 16, heightPct: 3, purpose: 'visual anchor' },
      { id: 'content', xPct: 7, yPct: 22, widthPct: 78, heightPct: 62, purpose: 'headline and supporting content' },
    ],
    hierarchy: [
      { role: 'headline', priority: 1 },
      { role: 'supporting-copy', priority: 2 },
      { role: 'brand', priority: 3 },
      { role: 'background', priority: 4 },
    ],
  };
}

function providerPolicy(task: VisualTaskV15): VisualBrainPlanV15['providerPolicy'] {
  const required: VisualProviderCapabilityV15[] = task === 'generate'
    ? ['vector']
    : task === 'edit'
      ? ['edit']
      : task === 'inpaint'
        ? ['inpaint']
        : task === 'outpaint'
          ? ['outpaint']
          : task === 'variation'
            ? ['variation']
            : ['raster'];
  const eligible = PROVIDERS.filter(provider =>
    provider.available
    && provider.verifiedZeroCost
    && provider.paidFallback === false
    && required.every(capability => provider.capabilities.includes(capability)),
  );
  return {
    requiredCapabilities: required,
    candidates: PROVIDERS,
    selectedProviderId: eligible[0]?.id ?? null,
    failClosedReason: eligible.length ? null : 'NO_VERIFIED_ZERO_COST_PROVIDER',
  };
}

function universalSpec(input: VisualArtifactRequestV15, plan: Pick<VisualBrainPlanV15, 'purpose' | 'platform' | 'style' | 'composition'>): string {
  const body = input.body?.trim();
  const subtitle = input.subtitle?.trim();
  const footer = input.footer?.trim();
  return [
    `Purpose: ${plan.purpose}.`,
    `Platform: ${plan.platform}; preset ${input.preset ?? 'portrait'}.`,
    `Visual direction: ${plan.style.direction}; ${plan.composition.principle}; controlled hierarchy; strong legibility.`,
    `Primary text: "${input.title.trim()}".`,
    subtitle ? `Secondary text: "${subtitle}".` : '',
    body ? `Supporting content: "${body}".` : '',
    footer ? `Footer/brand text: "${footer}".` : '',
    'Preserve exact user-provided text. Keep typography deterministic instead of asking an image model to redraw critical copy.',
    'Use generous negative space, safe margins, consistent alignment, and avoid visual clutter.',
  ].filter(Boolean).join(' ');
}

export function planVisualBrainV15(input: VisualArtifactRequestV15, task: VisualTaskV15 = 'generate'): VisualBrainPlanV15 {
  const preset = input.preset ?? 'portrait';
  const layout = input.layout ?? 'editorial';
  const purpose = purposeFor(input.kind);
  const platform = platformFor(preset);
  const composition = compositionFor(layout);
  const style = {
    direction: layout === 'minimal' ? 'quiet premium minimalism' : layout === 'split' ? 'structured modern contrast' : 'editorial modern clarity',
    density: (input.body && input.body.length > 420 ? 'high' : input.body && input.body.length > 120 ? 'medium' : 'low') as 'low' | 'medium' | 'high',
    visualNoise: 'restrained' as const,
    contrast: layout === 'split' ? 'strong' as const : 'controlled' as const,
  };

  const partial = { purpose, platform, style, composition };
  return {
    version: 'visual-brain-v1',
    task,
    purpose,
    audience: 'user-specified-or-general',
    platform,
    preset,
    kind: input.kind,
    style,
    composition,
    typography: {
      strategy: 'deterministic-overlay',
      maxTitleLines: preset === 'story' ? 4 : 3,
      maxBodyLines: preset === 'story' ? 10 : 7,
      preserveExactText: true,
    },
    lighting: { mode: 'graphic-flat', direction: 'n/a' },
    camera: { mode: 'n/a' },
    changePreserve: {
      change: task === 'generate' ? ['new composition'] : ['only explicitly requested regions/properties'],
      preserve: task === 'generate'
        ? ['exact text', 'brand-safe margins', 'requested aspect ratio']
        : ['unmentioned subjects', 'identity', 'pose', 'camera', 'crop', 'accepted layout', 'accepted text'],
    },
    promptCompiler: {
      universalVisualSpec: universalSpec(input, partial),
      avoid: [
        'generic AI robot imagery',
        'unnecessary neon',
        'busy composition',
        'uncontrolled typography',
        'cropped critical text',
        'low-contrast body copy',
      ],
    },
    criticRubric: {
      promptAdherence: 20,
      composition: 15,
      typography: 20,
      layout: 15,
      brandConsistency: 10,
      accessibility: 10,
      artifactSafety: 10,
    },
    providerPolicy: providerPolicy(task),
    iterationPolicy: {
      maxIterations: 3,
      bestOfN: 1,
      repairOnlyWhenBelow: 92,
    },
  };
}

export function visualProviderRegistryV15(): readonly VisualProviderDescriptorV15[] {
  return PROVIDERS;
}

export function visualBrainSelfTestV15(): { ready: boolean; checks: readonly string[] } {
  const sample: VisualArtifactRequestV15 = {
    kind: 'social-card',
    preset: 'portrait',
    layout: 'editorial',
    title: 'ORIGIN Personal',
    subtitle: 'Visual Intelligence',
    body: 'Clear, safe and verifiable visual composition.',
  };
  const plan = planVisualBrainV15(sample);
  const checks = [
    plan.providerPolicy.selectedProviderId === 'origin-local-svg' ? 'zero-cost-provider-selected' : '',
    plan.typography.strategy === 'deterministic-overlay' ? 'deterministic-typography' : '',
    plan.changePreserve.preserve.includes('exact text') ? 'preserve-map' : '',
    plan.promptCompiler.universalVisualSpec.includes('ORIGIN Personal') ? 'prompt-compiled' : '',
    plan.iterationPolicy.maxIterations === 3 ? 'bounded-repair-policy' : '',
  ].filter(Boolean);
  return { ready: checks.length === 5, checks };
}
