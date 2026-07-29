FROM node:22-alpine
RUN apk add --no-cache openssl
RUN npm install --global pnpm@11.9.0

EXPOSE 8080

WORKDIR /app

ENV NODE_ENV=production

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run build

CMD ["pnpm", "run", "docker-start"]
