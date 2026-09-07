# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY packages/contracts packages/contracts
COPY backend backend
RUN npm run build -w @izbri/contracts && npm run build -w backend

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/packages/contracts ./packages/contracts
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "backend"]
