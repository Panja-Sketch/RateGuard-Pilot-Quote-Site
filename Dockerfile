# Cloud Run image for the Pilot Quote Site API (+ static frontend). NOT built or deployed by any script here.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 PILOT_DATA_DIR=/tmp/pilot-data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY docs/openapi.json ./docs/openapi.json
COPY samples ./samples
# Run as the unprivileged "node" user; /tmp is the only writable location on Cloud Run.
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
