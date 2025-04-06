FROM oven/bun:1.0 as builder

WORKDIR /app

# Copy package management files
COPY package*.json ./
COPY bun.lockb ./

# Install dependencies including devDependencies for build
RUN bun install

# Copy all files needed for build
COPY . .

# Build the application
RUN bun run build

# Start fresh with Bun runtime for smaller final image
FROM oven/bun:1.0

WORKDIR /app

# Copy built files and necessary runtime files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lockb ./

# Install only production dependencies
RUN bun install --production

# Expose the port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:3000/ || exit 1

# Start the server using Bun
CMD ["bun", "run", "server.js"] 