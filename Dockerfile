# Stage 1: Build both client and server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and workspace package files to maximize Docker layer caching
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

# Use npm ci with lockfiles for deterministic, fast dependency installation
RUN npm ci
RUN npm ci --prefix client
RUN npm ci --prefix server

# Copy source code after dependencies are installed
COPY . .

# Build client and server
RUN npm run build:client
RUN npm run build:server

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Copy server package manifest and lockfile for fast production dependency installation
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /app/server/package.json /app/server/package-lock.json ./server/

# Install only production dependencies for the server using npm ci
RUN npm ci --prefix server --omit=dev

# Copy built server files
COPY --chown=node:node --from=builder /app/server/dist ./server/dist

# Copy built client files (static assets)
COPY --chown=node:node --from=builder /app/client/dist ./client/dist

# Security: run application as unprivileged node user
USER node

# Expose port (Cloud Run sets PORT env var automatically)
EXPOSE 5000
ENV PORT=5000

# Healthcheck to verify service availability
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

# Start the server
WORKDIR /app/server
CMD ["npm", "start"]
