# Use the official Node.js image
FROM node:22

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY . .

RUN npm i

# Expose the port (change if needed)
EXPOSE 7860

# Start the app (adjust if using a different entry point or script)
CMD ["npm", "start"]