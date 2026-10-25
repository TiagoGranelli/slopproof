# syntax=docker/dockerfile:1
# Base image of the agent eval (docs/agents/evals.md): this repository at /app as one fresh commit, installed,
# with Playwright's browsers. The eval tasks build on it. Build it from the repository root:
#   docker build -f .agents/evals/Dockerfile -t app-eval .
# Image pins are checked against scripts/images.ts by `pnpm ci:workflows`.
FROM node:26.12.0-slim@sha256:e556a144463cc8dc53afe8de6d2fa0db5c132fd39ffa232c17641bd40df2bf11 AS node
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager.split('+')[0]")"
# No git yet, so `prepare` (lefthook install) runs below, once the repository exists.
RUN pnpm install --frozen-lockfile --ignore-scripts
# .agents/evals/ stays out: the hidden checks and reference solutions must not be in the agent's checkout.
COPY --exclude=.agents/evals . .
RUN git init --quiet --initial-branch=main \
 && git config user.name eval \
 && git config user.email eval@example.invalid \
 && git add --all \
 && git commit --quiet -m Baseline \
 && pnpm exec lefthook install
COPY --chmod=755 .agents/evals/grade.sh /opt/eval/grade.sh
