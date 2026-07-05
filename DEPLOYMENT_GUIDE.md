# DEPLOYMENT_GUIDE.md - ACOS 2.0 Production Deployment Guide

This guide describes the procedures for building and deploying the AI Operating System (ACOS) 2.0 to production-grade serverless containers (e.g., Google Cloud Run, AWS Fargate) or high-availability virtual machines.

---

## 🌌 System Architecture Recap

ACOS 2.0 runs as a **Unified Full-Stack App** utilizing Express and Vite:
* **Frontend**: Single-page React application built with TypeScript, Tailwind CSS, and `motion/react`.
* **Backend**: Node.js Express server acting as a controller, coordination broker, and API proxy for Google GenAI services.
* **Production Build Strategy**: Bundles the entire backend into a single target file (`dist/server.cjs`) to minimize container warm-up latency and prevent runtime imports mismatch.

---

## 🏗️ Production Build Pipeline

To generate the deployment artifacts locally or inside a CI/CD Runner (GitHub Actions, Cloud Build):

```bash
# 1. Install precise production dependencies
npm ci

# 2. Compile and bundle frontend and backend
npm run build
```

### Artifact Outputs:
* `dist/` - Static frontend app files.
* `dist/server.cjs` - Bundled and optimized backend server.
* `dist/server.cjs.map` - Sourcemaps for production stack trace monitoring.

---

## 🚀 Running in Production

Launch the production server using the optimized `start` script:

```bash
# Set environment to production
export NODE_ENV=production

# Expose target Port (ACOS binds to 0.0.0.0:3000 by default)
export PORT=3000

# Execute server
npm run start
```

---

## ⚙️ Environment Configuration

You must supply the following environment variables inside your deployment target (never commit actual secrets to version control):

| Variable Name | Required | Description | Value Example |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | Defines execution environment | `production` |
| `GEMINI_API_KEY` | Yes | API key for Gemini models (lazy-loaded on server) | `AIzaSy...` |
| `PORT` | Optional | Core ingress routing port | `3000` |

---

## 🛡️ Production Hardening Checklist

1. **HTTPS Enforced**: Ensure all browser communication is routed through TLS v1.3 proxies.
2. **Container Limits**: Allocate at least **1 vCPU** and **2GB RAM** (Peak memory usage is ~380MB, but large-scale agent multi-debates benefit from stable CPU scheduling).
3. **Log Rotation**: Configure cloud logs to parse Express standard output. Prevent API key values from echoing in debug logs.
4. **CORS Configuration**: Restrict allowed cross-origin headers to verified domain mappings if exposing secondary APIs.
