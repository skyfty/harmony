# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# Use repo root as base so we can bring in sibling packages (e.g., ../schema)
WORKDIR /app
# Ensure devDependencies (e.g., typescript) are installed for compilation
ENV NODE_ENV=development
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
# Bring in the local schema package so file:../schema can be resolved during install
COPY schema ./schema

# Install deps for server (use pnpm with lockfile for reproducibility)
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# TypeScript also type-checks files from /app/schema (via file:../schema).
# Node-style module resolution from /app/schema walks up to /app/node_modules,
# so expose the server's node_modules there for the build.
RUN [ -e /app/node_modules ] || ln -s /app/server/node_modules /app/node_modules

# Ensure the dependency points to the full schema directory.
RUN rm -rf /app/server/node_modules/@harmony/schema && ln -s /app/schema /app/server/node_modules/@harmony/schema

# Install schema dependencies (schema/node_modules is not copied into Docker context).
RUN pnpm --dir /app/schema install --frozen-lockfile

# Build schema so its package exports (dist/*.js) exist for runtime imports.
RUN pnpm --dir /app/schema run build

# Copy source for build (TypeScript compile)
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
# Build to dist (package.json build already runs tsc, tsc-alias, and extension fixer)
RUN pnpm run build
# Remove dev dependencies after build to shrink node_modules copied to runtime
RUN pnpm prune --prod

# --- Runtime Stage ---
FROM node:20-alpine AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
# Create non-root user
RUN addgroup -S harmony && adduser -S harmony -G harmony

# Copy only needed production node_modules and dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
# If the installer links @harmony/schema to /app/schema, ensure the target exists at runtime
COPY --from=build /app/schema /app/schema
COPY server/package.json ./package.json
# Copy any runtime assets (uploads will be a volume)
VOLUME ["/app/uploads"]
# Expose application port (default 4000)
EXPOSE 4000
# Default command
CMD ["node", "dist/index.js"]
