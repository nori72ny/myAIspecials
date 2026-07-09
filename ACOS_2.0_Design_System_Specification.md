# ACOS 2.0 Design System Specification
## "The Cosmic Obsidian & Luminescent Glass" — Master Design System & UI/UX Blueprint
**Stewardship of the Principal Product Designer**

---

## 🌌 1. Design Philosophy & Mood Board
ACOS 2.0 is designed not as a generic dashboard, but as a **living, breathing AI Operating System**. It is a tool for developers, managers, and visionaries alike, offering high-density complexity wrapped in elegant simplicity.

### Core Visual Metaphors
- **Tactile Glassmorphism (Physicality)**: Elements float with real-world physics. Layers represent hierarchy, employing subtle sub-pixel borders, back-refractive ambient blurring, and high-contrast text rendering.
- **Obsidian Space (The Background)**: Deep, dark, eye-safe midnight canvases (`#030712`) provide infinite depth. Content cards float using absolute charcoal gray (`#0F172A`) or deep graphite (`#1E293B`) to establish structural containers.
- **Luminescent Energy (The Accents)**: State changes and dynamic execution flows are indicated by precise neon light channels:
  - **Luminescent Indigo (`#6366F1`)**: The cognitive core, represents the Goal Engine and Intent layers.
  - **Ethereal Teal (`#14B8A6`)**: System execution, Represents active workflow tasks, tools, and processing engines.
  - **Hyper Cyan (`#06B6D4`)**: Context and memory integration, representing the Knowledge and Memory engines.
  - **Muted Aurora Rose (`#F43F5E`)**: Critical self-healing, quota limits, or security exceptions.

---

## 🎨 2. Color System & Contrast Standards (WCAG 2.1 AA Compliant)

### A. Dark Cosmic Palette (Main Theme)
We utilize a bespoke high-density dark mode where elements are defined by borders and highlights rather than solid light blocks.

| Token Name | Hex Code | Tailwind Equivalent | Role |
| :--- | :--- | :--- | :--- |
| `surface-space` | `#030712` | `bg-slate-950` | Infinite cosmic void background |
| `surface-panel` | `#0B0F19` | — | Primary layout panel background |
| `surface-card` | `#111827` | `bg-gray-900` | Floating widget, input fields, interactive units |
| `surface-overlay`| `#1F2937` | `bg-gray-800` | Modal dialogue, context menus, tooltip sheets |
| `border-subtle` | `#1E293B` | `border-slate-800` | Grid line separators, default card borders |
| `border-glowing`| `#312E81` / `#115E59` | — | Selected/active system state boundaries |

### B. Accent System (Semantic Lights)
These are used sparingly for focus rings, status indicators, and motion trails.

| Accent Role | Color Hex | Tailwind Class | Semantic Usage |
| :--- | :--- | :--- | :--- |
| **Cognitive Core** | `#818CF8` | `text-indigo-400` | Goal formulation, Intent extraction |
| **Active Compute** | `#2DD4BF` | `text-teal-400` | Executor running, tool invoke, agent action |
| **Data & Memory** | `#22D3EE` | `text-cyan-400` | Vector database recall, semantic match |
| **System Safe** | `#34D399` | `text-emerald-400` | Consensus reached, task audit passed (100%) |
| **Failure/Warning**| `#F87171` | `text-red-400` | Exception thrown, self-healing loop engaged |

---

## ✍️ 3. Typography Pairings & Visual Rhythm

Typography conveys architectural intent. We pair standard Swiss grotesques with high-precision monospace numerals.

- **Primary Sans (UI & Interface)**: **Inter** or **Outfit**
  - Tracking: `-0.02em` on titles (tightens letter-spacing for premium feel); `0` on body copy.
  - Sizing Ratios: Major Third scale (1.25x).
- **Secondary Monospace (System Metrics & Logs)**: **JetBrains Mono** or **Fira Code**
  - Role: Displays execution logs, latency values, token statistics, and code snippets.

### Typographic Hierarchy Tokens
```css
/* Figma Typography Styles */
--font-display: 'Outfit', 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;

.type-display-lg { font-family: var(--font-display); font-size: 32px; font-weight: 900; letter-spacing: -0.03em; line-height: 1.1; }
.type-display-md { font-family: var(--font-display); font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
.type-header-sm  { font-family: var(--font-display); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.4; }
.type-body-copy  { font-family: var(--font-display); font-size: 14px; font-weight: 400; letter-spacing: 0em;     line-height: 1.6; }
.type-system-log { font-family: var(--font-mono);    font-size: 11px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.5; }
```

---

## 📐 4. Spacing, Grid, & Elevation Principles

We reject generic layout spacing in favor of **Intentional Density Variation**.

### A. The 8px Core Grid
Spacing values must adhere to the 8px spatial grid to align elements perfectly with standard device display scaling.

- **Micro-Gap (`4px`)**: Text labels to icon pairs.
- **Compact (`8px`)**: Form inputs to labels, grid cells inside a table.
- **Comfortable (`16px`)**: Nested sections inside card views, inline buttons.
- **Structural (`24px`)**: Padding within cards, spacing between primary sidebar and workspace.
- **Sectional (`32px` / `48px`)**: Outer panel layouts, viewport page headers.

### B. Responsive Grid Layouts
The ACOS dashboard adapts fluidly using CSS Grid and sub-grid wrappers.

- **Desktop (`>= 1280px`)**: 
  - Structural Left Navigation Sidebar: Fixed `240px` width.
  - Active Compute Rail (Right panel): Fixed `320px` width.
  - Center Dynamic Workspace: Flexible 12-column grid container.
- **Tablet (`768px` to `1279px`)**: 
  - Sidebar collapses into an elegant floating bottom drawer or top-nav utility bar.
  - Right panel collapses into a sliding sheet overlay.
  - Center workspace moves into an 8-column layout.
- **Mobile (`< 768px`)**: 
  - Dynamic single-column bento card flow.
  - Touch targets expand to a minimum of `48px` height.
  - Dense log metrics hide behind a clean expander accordion.

---

## ✨ 5. Motion, Animation, & Micro-interactions
Motion in ACOS is physical, lightweight, and purposeful. It represents the "thinking speed" of the agentic core.

- **Standard Page Transition (The Easing Curve)**:
  - Custom cubic bezier: `cubic-bezier(0.16, 1, 0.3, 1)` (Ultra-premium ease-out, starts blindingly fast, slows down with smooth elasticity).
  - Duration: `350ms`.
- **The Cognitive Expansion Transition**:
  - When a user submits a Goal, the Goal expands into the Intent box using **staggered delayed spring transitions** (`motion/react` layout animation) with a subtle blur fade-in.
- **The Execution Processing Pulse**:
  - Active tasks blink not like generic lights, but with a fluid 2-second breathing pulse: `box-shadow: 0 0 15px rgba(45, 212, 191, 0.3)`.

---

## 🛠️ 6. Figma-Level UI Component Specifications

### A. The Ambient Glass Card (`Card`)
```html
<!-- Figma Properties: Frame (W: Auto, H: Auto), Corner Radius: 16px, Border: 1px Solid #1E293B -->
<div class="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-md p-6 hover:border-indigo-500/50 transition-all duration-300 shadow-lg shadow-black/20">
  <div class="flex items-center justify-between mb-4">
    <span class="text-xs font-mono text-indigo-400 tracking-wider font-bold">GOAL ID: G-203</span>
    <span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">CLARIFYING</span>
  </div>
  <p class="text-sm font-medium text-slate-200">Refine enterprise system architectures and deploy multi-cloud API instances.</p>
</div>
```

### B. The Glowing Cognitive Submit Button (`SubmitButton`)
```html
<!-- Figma Properties: Auto Layout, H-Padding: 24px, V-Padding: 12px, Background: Linear Gradient (135deg, #4F46E5, #06B6D4) -->
<button class="relative px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 font-bold text-sm text-white shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-cyan-400">
  Submit Core Goal
</button>
```

---

## 🖥️ 7. View-by-View Figma Layout Specification (The Core Workspaces)

### 1. Goal UI (The Intake Chamber)
- **Structure**: A large, centered input zone with zero distraction. The outer background is deep midnight slate.
- **UX Sequence**:
  1. The user inputs: *"Increase our engineering output by automating boilerplate code validation."*
  2. Upon hitting `Enter`, the text-area elegantly scales down, moving upwards to reveal the **Intent Analyzer** block underneath it.

### 2. Intent UI (The Cognitive Crucible)
- **Structure**: Split-screen card grid.
  - **Left Card**: Clarified Objective (structured list of target variables).
  - **Right Card**: Security Constraints & Guardrails (e.g., *"No exposed credentials"*, *"Docker isolation only"*).
- **Interaction**: The user can hover over any auto-generated constraint and click "Adjust" or "Override", displaying Apple-like toggle sliders.

### 3. Workflow UI (The Autonomous Planner)
- **Structure**: A horizontal, interactive bento timeline.
  - Cards represent sequential/parallel tasks (e.g., Task 1: Scraping, Task 2: Reasoning, Task 3: Execution, Task 4: Human Review).
  - Lines connecting cards represent execution dependency chains, pulsing with glowing green light signals when a task finishes and its downstream data feeds into the next.

### 4. Active Execution & Tool UI (The Compute Core)
- **Structure**: A high-speed, live console log coupled with dynamic system health charts.
- **UI Element**: Active capability rating bars. If the routing engine chooses Claude 3.5 Sonnet because of high `Reasoning` and `Coding` ratings, the UI renders live radar charts or bar graphs showing the selected capability highlight.

### 5. Memory & Knowledge UI (The Experience Vault)
- **Structure**: A floating particle field (represented by a dense, elegant list with search and filtering properties).
  - Each memory block displays its "Confidence Score", "Recall Latency" (e.g., `45ms`), and "Semantic Match Ratio" (`0.98`).
  - Perfect for visual verification of what past experiences are influencing the active agent step.

---

## 📱 8. Multi-Device Responsive Rules Matrix

```text
+-------------------+----------------------------+----------------------------+
| Feature           | Desktop (>= 1280px)        | Tablet (768px - 1279px)    |
+-------------------+----------------------------+----------------------------+
| Left Nav Sidebar  | Permanent Docked (240px)   | Left sliding drawer        |
| Right Compute Panel| Permanent Docked (320px)  | Right sliding sheet overlay|
| Bento Chart Grid  | 4 columns grid, full density| 2 columns grid, scroll-y   |
| Live Console Log  | Nested right-column, 300px | Modal console drawer       |
| Touch Targets     | 36px buttons, hover rings   | 48px buttons, tap feedback |
+-------------------+----------------------------+----------------------------+
```

---

## 💎 9. Summary: How to Build This Design System in React & Tailwind

To instantiate this beautiful design, developers should:
1. Import **Outfit** for elegant display headlines, and **JetBrains Mono** for developer logs into `src/index.css`.
2. Map the dark colors (`surface-space`, `surface-panel`) inside the `@theme` block of Tailwind.
3. Keep the layout modular: separate the `LeftSidebar`, `CenterWorkspace`, and `ActiveRightPanel` components to allow the CSS responsive flexboxes to scale fluidly without causing token generation overflows.
