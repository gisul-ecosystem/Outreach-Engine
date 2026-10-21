# One image for both the web app and the worker (same code, different start command).
# Used by docker-compose.yml (profile "app"). Day-to-day development does not need it.
FROM node:22-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first so Docker can cache this layer until package files change.
# devDependencies are kept on purpose: the worker and scripts run with `tsx`.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `next build` does not need secrets (env is validated lazily at runtime).
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Default = web app. The worker service overrides this command.
CMD ["npm", "run", "start"]
