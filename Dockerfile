# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --chown=node:node src/ ./src/
COPY --chown=node:node scripts/check-health.mjs ./scripts/check-health.mjs
COPY --chown=node:node scripts/init-workflows.mjs ./scripts/init-workflows.mjs
COPY --chown=node:node LICENSE NOTICE THIRD-PARTY.md ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 CMD ["node", "scripts/check-health.mjs"]
CMD ["node", "src/server.mjs"]
