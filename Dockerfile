# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# The gRPC server loads the .proto file at runtime.
COPY proto ./proto
# Supabase CA certificate (public, not a secret) for DATABASE_SSL_CA_PATH.
COPY certs ./certs


EXPOSE 3001 50051
CMD ["node", "dist/server.js"]
