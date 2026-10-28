# Use official Node.js slim Debian image
FROM node:20-slim

# Install Chromium and necessary dependencies for headless browser automation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Point CHROME_PATH directly to the installed Chromium binary
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application files
COPY . .

# Expose default port
EXPOSE 5000

# Start the Lighthouse Express backend
CMD ["node", "server.js"]
