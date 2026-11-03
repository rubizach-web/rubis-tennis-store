# Production image for Cloud Run (built by .github/workflows/deploy.yml)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Cloud Run sets PORT (8080); server.ts listens on it
CMD ["node", "dist/server.cjs"]
