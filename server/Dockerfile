FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./

EXPOSE 8080
CMD ["node", "index.mjs"]
