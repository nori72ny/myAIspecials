# SECURITY.md - ACOS Security Policy & Audit

## 🛡️ Security Policy

This document outlines the security architecture, threat models, and vulnerability reporting procedures for the AI Operating System (ACOS) 2.0.

ACOS is built on a Zero-Trust Architecture to manage high-orchestration multi-agent pipelines without exposing sensitive cloud resources or agent context.

---

## 🔒 Implemented Security Protections (OWASP Top 10 Alignment)

### 1. API Key Isolation & Secure Proxy (A01:2021-Broken Access Control)
* **No Client Keys**: Standard environment rules forbid the storage or exposure of `GEMINI_API_KEY` or other 3rd-party keys on the browser client.
* **Server-Side Brokerage**: All LLM queries and workspace sync operations are routed through secure, container-bound Express endpoints inside `/api/*`.
* **Credential Sealing**: Secrets are mounted only inside the production environment variable layer and are read lazily (`process.env.GEMINI_API_KEY`), eliminating static memory leaks.

### 2. Prompt Injection Mitigation (A03:2021-Injection)
* **Adversarial Scanner**: ACOS implements an inline lexical scanner detecting prompt bypass patterns like:
  - `Ignore previous instructions`
  - `System override`
  - `You are now a developer`
* **Output Sanitization**: Model responses are scanned to block rogue HTML tags and script injections before layout injection.

### 3. XSS & HTML Safety (A03:2021-Injection)
* **React Native Shield**: All user and agent responses are rendered through React’s JSX tree, providing native context-sensitive encoding.
* **Markdown Sandbox**: When rendering rich documentation markdown (`react-markdown`), the component strictly escapes arbitrary `<script>` modules and custom styles. `dangerouslySetInnerHTML` is audited and forbidden in all standard components.

### 4. LocalStorage & Local Memory Audits (A04:2021-Insecure Design)
* **State Partitioning**: Client local state backups are strictly structured. Sensitive cryptographic materials or temporary credentials are never cached in `localStorage`.
* **Reconnection Isolation**: On state hydration after disconnect, payload structures are schema-validated to prevent local storage corruption attacks.

---

## 📁 Security Audit Overview

| Risk Identifier | Severity | Mitigation Vector | Status |
| :--- | :--- | :--- | :--- |
| **API Key Leakage** | Critical | Enforced server-side Lazy proxying | **SECURED** |
| **Prompt Injection** | High | Added Adversarial Syntax filters | **MITIGATED** |
| **Cross-Site Scripting (XSS)** | High | Standard JSX escaping + sanitized Markdown | **SECURED** |
| **Local State Tampering** | Medium | Structural validation on restore | **MITIGATED** |
| **Dependency Injection** | Low | Regular security scanning on imports | **MONITORED** |

---

## 📬 Reporting Vulnerabilities

If you discover any security issues or prompt-leak vectors, please do not open a public issue. Email us directly at `security@acos-origin.io` so we can investigate and address the vulnerability coordinate-responsibly.
