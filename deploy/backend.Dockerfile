# syntax=docker/dockerfile:1
#
# One image, three entrypoints: serve, migrate, create a user.
#
# ponytail: devDependencies stay in the final image. `npm run migrate` and
# `npm run user:create` are ts-node CLIs reading .ts sources — a --omit=dev
# runtime could not run either, and the alternative is a second image whose only
# job is to be the first one plus ts-node. Costs ~100 MB of layer nobody pays
# for at runtime. Split them when image size actually hurts.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Non-root, because nothing here needs to be root and the container talks to the
# internet through nginx.
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
# `src` and `migrations` are what the two CLIs read; `tsconfig` is what ts-node
# needs to read them.
COPY --chown=app:app package.json tsconfig*.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app migrations ./migrations
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
