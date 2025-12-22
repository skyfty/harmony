# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# Use repo root as base so we can bring in sibling packages (e.g., ../schema)
WORKDIR /app
# Ensure devDependencies (e.g., typescript) are installed for compilation
ENV NODE_ENV=development
# Bring in the local schema package so file:../schema can be resolved during install
COPY schema ./schema

# Install deps for server (use npm ci for reproducibility)
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci

# TypeScript also type-checks files from /app/schema (via file:../schema).
# Node-style module resolution from /app/schema walks up to /app/node_modules,
# so expose the server's node_modules there for the build.
RUN [ -e /app/node_modules ] || ln -s /app/server/node_modules /app/node_modules

# Copy source for build (TypeScript compile)
COPY server/tsconfig.json ./tsconfig.json
COPY server/scripts ./scripts
COPY server/src ./src
# Build to dist (package.json build already runs tsc, tsc-alias, and extension fixer)
RUN npm run build
# Remove dev dependencies after build to shrink node_modules copied to runtime
RUN npm prune --omit=dev

# --- Runtime Stage ---
FROM node:20-alpine AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
# Create non-root user
RUN addgroup -S harmony && adduser -S harmony -G harmony

# Copy only needed production node_modules and dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
# If npm installed @harmony/schema as a symlink to /app/schema, ensure the target exists at runtime
COPY --from=build /app/schema /app/schema
COPY server/package.json ./package.json
# Copy any runtime assets (uploads will be a volume)
VOLUME ["/app/uploads"]
# Expose application port (default 4000)
EXPOSE 4000
# Default command
CMD ["node", "dist/index.js"]
