# KNOWN_LIMITATIONS.md - ACOS 2.0 Known Limitations

This document lists the technical trade-offs, scope boundaries, and architectural limitations identified during the validation of the ACOS 2.0 Release Candidate 2.

---

## 📌 Architectural & Scope Boundaries

### 1. Transient Client-Side Storage
* **Context**: User workspace configuration and temporary mission states are backed up dynamically in the browser's local storage to prevent session loss.
* **Limitation**: Clearing the browser cache or accessing ACOS via a private/incognito tab will reset local workspace states if not backed up to an external system. Long-term agent evolution memories are persisted inside server-side memory buffers, but are cleared on server process restarts.

### 2. Sandbox File Manipulation
* **Context**: Agent execution workspace relies on Node-level virtual file-system mappings.
* **Limitation**: Complex desktop actions, native IDE integration, and file mounts are constrained to the Node process's container sandbox. Real disk changes require explicit cloud storage attachments.

---

## ⚡ Technical Limits

### 1. Concurrent Agent Scale
* **Limits**: While ACOS 2.0 supports up to **1,000+ active virtual agents** through state partitioning, executing deep iterative debates or large-scale multi-org consensus simultaneously can exceed the Gemini API rate limits (such as requests per minute / TPM) under high-throughput workloads.
* **Recommendation**: If encountering rate-limit warnings (HTTP 429), enable queueing or integrate enterprise-tier keys.

### 2. Real-Time WebSocket Fallback
* **Limits**: In sandboxed iframe environments where WebSockets are restricted by parent browser policies, the communication layer falls back to high-frequency polling.
* **Recommendation**: Open ACOS in a dedicated new tab to restore full WebSocket throughput and bypass iframe permissions.

### 3. Screen Reader Focus Management on Dynamic Graphs
* **Limits**: The interactive SVG Network Graph visually representing agent relationships requires manual tab index progression for perfect non-visual navigation.
* **Recommendation**: Use the supplementary tabular layout inside the "Strategic Review" tab for fully accessible text descriptions of the organization hierarchies.
