# ---- Build Stage ----
FROM node:18-alpine AS build
WORKDIR /app

# Copy workspace manifests
COPY package.json ./
COPY src/backend/package.json ./src/backend/package.json
COPY src/frontend/package.json ./src/frontend/package.json

# Install root deps & workspaces
RUN npm install --omit=dev

# Copy full source
COPY . .

# Build backend
RUN npm --workspace=src/backend run build
# Build frontend
RUN npm --workspace=src/frontend run build

# ---- Runtime Stage ----
FROM node:18-alpine
WORKDIR /app
COPY --from=build /app/src/backend/dist ./backend
COPY --from=build /app/src/frontend/build ./frontend
COPY --from=build /app/models ./models
COPY --from=build /app/package.json ./package.json

# Install prod deps only
RUN npm install --omit=dev --workspace=src/backend

ENV PORT=3000
ENV OLLAMA_BASE_URL=http://ollama:11434

EXPOSE 3000 11434

CMD ["node", "backend/server.js"]
