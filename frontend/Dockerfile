# Build from the repository root: docker build -f frontend/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_URL=http://backend:3001
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY packages/contracts packages/contracts
COPY frontend frontend
RUN npm run build -w @izbri/contracts && npm run build -w frontend

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_URL=http://backend:3001
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend ./frontend
COPY --from=build /app/packages/contracts ./packages/contracts
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "frontend"]
