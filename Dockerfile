FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install

# Install Python + pdfplumber for A-Systems PDF import
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages pdfplumber \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy source
COPY . .

# Build frontend only (server runs from source with bun)
RUN bun run build

# Verify build output exists
RUN ls -la dist/client/index.html

# Create data directory and non-root user
RUN mkdir -p /app/data && \
    groupadd -r birddog && useradd -r -g birddog birddog && \
    chown -R birddog:birddog /app /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Start as root to fix volume ownership, then drop to birddog for the app
CMD ["sh", "-c", "chown -R birddog:birddog /app/data && exec su -s /bin/sh birddog -c 'echo Starting BirdDog... && bun server/migrate.ts && bun server/seed.ts && bun server/seed-tools.ts && bun server/seed-vehicles.ts && echo Ready && bun server/index.ts'"]
