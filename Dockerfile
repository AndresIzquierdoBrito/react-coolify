FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

FROM dependencies AS contracts
COPY packages/contracts packages/contracts
RUN npm run build -w @izbri/contracts

FROM contracts AS backend-builder
COPY backend backend
RUN npm run build -w backend

FROM contracts AS frontend-builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_URL=http://backend:3001
COPY frontend frontend
RUN npm run build -w frontend

FROM node:24-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-builder /app/package.json /app/package-lock.json ./
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/package.json
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=backend-builder /app/packages/contracts/dist ./packages/contracts/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "backend"]

FROM node:24-alpine AS frontend
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_URL=http://backend:3001
COPY --from=frontend-builder /app/package.json /app/package-lock.json ./
COPY --from=frontend-builder /app/node_modules ./node_modules
COPY --from=frontend-builder /app/frontend/package.json ./frontend/package.json
COPY --from=frontend-builder /app/frontend/public ./frontend/public
COPY --from=frontend-builder /app/frontend/.next ./frontend/.next
COPY --from=frontend-builder /app/frontend/next.config.ts ./frontend/next.config.ts
COPY --from=frontend-builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=frontend-builder /app/packages/contracts/dist ./packages/contracts/dist
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "frontend"]
