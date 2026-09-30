# AirWard Federation - Google Cloud Run Dockerfile
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Install dependencies first for Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source, prompts, and static frontend assets
COPY server.js ./
COPY prompts/ ./prompts/
COPY public/ ./public/

# Expose standard Cloud Run port
EXPOSE 8080

# Run server as non-root user
USER node

# Start API service
CMD ["node", "server.js"]
