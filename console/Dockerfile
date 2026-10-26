# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS builder

WORKDIR /console
COPY console/package.json console/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY console/ ./
RUN npm run build

FROM nginx:stable-bookworm@sha256:552e7481ca93ffccd046aa658dbbed22caefbc09c66fa7cd247cbb90b8a5c609 AS runtime

COPY console/nginx/nginx.conf /etc/nginx/nginx.conf
COPY console/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY console/nginx/proxy.conf /etc/nginx/snippets/console-proxy.conf
COPY --from=builder /console/dist/ /usr/share/nginx/html/
COPY LICENSE NOTICE THIRD-PARTY.md /usr/share/licenses/rosetta/

USER nginx
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
