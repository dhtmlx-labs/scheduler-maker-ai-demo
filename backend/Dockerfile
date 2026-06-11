FROM node:20-alpine AS build

WORKDIR /app

COPY .npmrc package*.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace=backend

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY .npmrc package*.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev

COPY --from=build /app/backend/dist backend/dist

WORKDIR /app/backend

EXPOSE 3001

CMD ["npm", "run", "start"]
