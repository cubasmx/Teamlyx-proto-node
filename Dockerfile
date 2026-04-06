FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first for cache layer
COPY package*.json ./
RUN npm install --omit=dev

# Copy all application code
COPY . .

# Expose Node.js port
EXPOSE 3001

# Start script
CMD ["npm", "start"]
