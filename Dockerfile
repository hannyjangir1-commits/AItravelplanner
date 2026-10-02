# Stage 1: Build both client and server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root config
COPY package.json package-lock.json ./

# Copy client and server package files to install dependencies
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

# Install all dependencies (root, client, server)
RUN npm install
RUN npm install --prefix client
RUN npm install --prefix server

# Copy all source code
COPY . .

# Build client and server
RUN npm run build:client
RUN npm run build:server

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Copy only production dependencies and built files
COPY package.json ./
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/client/package.json ./client/

# Only install production dependencies for the server (client is static)
RUN npm install --prefix server --omit=dev

# Copy built server files
COPY --from=builder /app/server/dist ./server/dist

# Copy built client files
COPY --from=builder /app/client/dist ./client/dist

# Expose port (Cloud Run sets PORT env var automatically)
EXPOSE 5000
ENV PORT=5000

# Start the server
WORKDIR /app/server
CMD ["npm", "start"]
