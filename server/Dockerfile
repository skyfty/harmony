# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
# Install deps (use npm ci for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci
# Copy source for build (TypeScript compile)
COPY tsconfig.json ./
COPY src ./src
# Build to dist (tsconfig outputs there)
RUN npm run build
# Remove dev dependencies after build to shrink node_modules copied to runtime
RUN npm prune --omit=dev

# --- Runtime Stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Create non-root user
RUN addgroup -S harmony && adduser -S harmony -G harmony

# Copy only needed production node_modules and dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Copy any runtime assets (uploads will be a volume)
VOLUME ["/app/uploads"]
# Expose application port (default 4000)
EXPOSE 4000
# Default command
CMD ["node", "dist/index.js"]
