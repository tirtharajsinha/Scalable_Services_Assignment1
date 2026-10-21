# Build from repository root. Deployment is Assignment 2 work.
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY docs/openapi ./docs/openapi
RUN npm ci --omit=dev --ignore-scripts
USER node
ENV HOST=0.0.0.0
CMD ["node", "services/booking/src/main.mjs"]
