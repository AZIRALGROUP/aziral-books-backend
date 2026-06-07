# --- builder ---
FROM node:22-alpine AS builder
WORKDIR /app

# pnpm
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

COPY package.json pnpm-lock.yaml* ./
# --ignore-scripts: skip postinstall (esbuild native build). We don't need
# esbuild at runtime — tsc compiles to plain JS executed by node.
RUN pnpm install --frozen-lockfile=false --ignore-scripts

COPY . .
RUN pnpm build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# drizzle migrations directory (generated via `pnpm db:generate`).
# Empty placeholder so the dir always exists; mounted/copied when migrations land.
RUN mkdir -p ./drizzle

EXPOSE 8080
CMD ["node", "dist/index.js"]
