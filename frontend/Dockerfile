FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_SOCKET_URL=http://localhost:3001
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

COPY .npmrc package*.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace=frontend

FROM nginx:1.27-alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK CMD wget -qO- http://localhost/ || exit 1
