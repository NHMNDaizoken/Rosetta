# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . ./
RUN npm run build

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm install -g vite
COPY --from=builder /app/dist ./dist
COPY vite.config.ts ./

USER node
EXPOSE 3000

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
