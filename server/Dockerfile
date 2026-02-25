# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# Use repo root as base so we can bring in sibling packages (e.g., ../schema)
WORKDIR /app
# Ensure devDependencies (e.g., typescript) are installed for compilation
ENV NODE_ENV=development
RUN corepack enable
ENV PNPM_VERSION=10.28.2
ENV NPM_REGISTRY_URL=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY_URL}

# Remove any existing pnpm binary and install pnpm from the mirror to avoid timeouts
RUN rm -f /usr/local/bin/pnpm || true && npm install -g pnpm@${PNPM_VERSION} --registry=${NPM_REGISTRY_URL} --force
# Bring in the local schema package so file:../schema can be resolved during install
COPY schema ./schema
# Also bring in local tools package so file:../tools can be resolved
COPY tools ./tools

# Ensure pnpm uses the mirror for all installs in the container
RUN echo "registry=${NPM_REGISTRY_URL}" > /app/.npmrc && echo "registry=${NPM_REGISTRY_URL}" > /root/.npmrc

# Install and build local tools package so its `dist` and `bin` exist
RUN pnpm --dir /app/tools install --frozen-lockfile --registry=${NPM_REGISTRY_URL} && pnpm --dir /app/tools run build

# Install deps for server (use pnpm with lockfile for reproducibility)
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
# Try a frozen install for reproducibility; fall back to non-frozen if lockfile
# is out of date (helps CI/builds when package.json was updated in the image).
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY_URL} || pnpm install --no-frozen-lockfile --registry=${NPM_REGISTRY_URL}

# TypeScript also type-checks files from /app/schema (via file:../schema).
# Node-style module resolution from /app/schema walks up to /app/node_modules,
# so expose the server's node_modules there for the build.
RUN [ -e /app/node_modules ] || ln -s /app/server/node_modules /app/node_modules

# Ensure the dependency points to the full schema directory.
RUN rm -rf /app/server/node_modules/@harmony/schema && ln -s /app/schema /app/server/node_modules/@harmony/schema

# Install schema dependencies (schema/node_modules is not copied into Docker context).
RUN pnpm --dir /app/schema install --frozen-lockfile --registry=${NPM_REGISTRY_URL}

# Build schema so its package exports (dist/*.js) exist for runtime imports.
RUN pnpm --dir /app/schema run build
# Ensure ESM file extensions are fixed in schema dist for Node resolution
RUN node /app/tools/dist/cli-bin.js fix-esm-extensions --root /app/schema/dist || true

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
