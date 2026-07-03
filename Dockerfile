# Multi-stage production-ready Dockerfile for ACOS 2.0
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build the application
COPY . .
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built assets and server bundles from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the correct port
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start"]
