# The shim implements the Files protocol used by @cloudflare/sandbox.
# Keep this tag equal to the installed @cloudflare/sandbox version.
FROM docker.io/cloudflare/sandbox:1.0.3 AS sandbox-tools
FROM oven/bun:1 AS bun-tools

FROM node:24-trixie-slim

COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=bun-tools /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    openssh-client \
    ripgrep \
    jq \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    procps \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace
WORKDIR /workspace

CMD ["sleep", "infinity"]
