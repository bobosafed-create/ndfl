FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-root-ca.crt

EXPOSE 3000

CMD ["node", "server.mjs"]
