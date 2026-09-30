# AirWard Federation - Root Dockerfile for Google Cloud Build / Cloud Run
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Install dependencies from server
COPY server/package*.json ./
RUN npm install --omit=dev

# Copy server application and prompts
COPY server/server.js ./
COPY server/prompts/ ./prompts/

# Copy all frontend files directly into public/ for static serving
COPY index.html ./public/index.html
COPY styles.css ./public/styles.css
COPY js/ ./public/js/
COPY assets/ ./public/assets/

EXPOSE 8080
USER node
CMD ["node", "server.js"]
