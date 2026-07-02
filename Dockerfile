# ---------- build the app ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# self-hosted build serves from the domain root
ENV VITE_BASE=/
ENV VITE_SELF_HOSTED=1
RUN npm run build

# ---------- runtime: static + /cowrite via Agent SDK ----------
FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
# ripgrep is bundled-optional for the agent runtime; keep image lean otherwise
RUN npm init -y >/dev/null && npm install @anthropic-ai/claude-agent-sdk@latest >/dev/null 2>&1
COPY --from=build /app/dist ./dist
COPY server/server.mjs ./server/server.mjs
EXPOSE 8090
# HOME must be writable for the agent runtime's session files
ENV HOME=/srv/home
RUN mkdir -p /srv/home && chown -R node:node /srv
USER node
CMD ["node", "server/server.mjs"]
