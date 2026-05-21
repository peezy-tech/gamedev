# Build stage
FROM node:24.15.0-alpine AS builder
WORKDIR /app

# Install Python and build tools
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev

# Install Vite Plus and copy workspace metadata first
RUN corepack enable && npm install -g vite-plus@0.1.22
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages ./packages
RUN vp install --frozen-lockfile

# Copy all source files and build
COPY . .
RUN vp run build

# Production stage
FROM node:24.15.0-alpine AS production
WORKDIR /app

# Add curl for healthcheck and ca-certificates for SSL
RUN apk add --no-cache curl ca-certificates && \
    update-ca-certificates && \
    adduser -S nodeuser -u 1001

# Copy only necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts

# Set build argument and environment variable
ARG COMMIT_HASH=local
ENV COMMIT_HASH=${COMMIT_HASH:-local} \
    NODE_ENV=production

# Expose the port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=2s --timeout=10s --start-period=5s --retries=5 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "build/index.js"]
