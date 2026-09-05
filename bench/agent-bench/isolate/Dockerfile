# One image, every agent. Built ONLINE (`pnpm bench:image`); trials then run
# it on an --internal network with no route out, so everything an agent needs
# must already be in here. Versions are build args so a run can pin exactly
# what it benchmarked — they default to the versions verified in
# AGENT-BENCH.md §5 and should move in lockstep with the adapter files.

FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.251
ARG OPENCODE_VERSION=1.18.25
# A released freecode binary — the self-contained bun build, never the SEA one.
ARG FREECODE_VERSION=v0.30.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      opencode-ai@${OPENCODE_VERSION}

RUN curl -fsSL -o /tmp/freecode.tar.gz \
      https://github.com/ayan-de/freecode/releases/download/${FREECODE_VERSION}/freecode-linux-x86_64.tar.gz \
 && mkdir -p /opt/freecode \
 && tar -xzf /tmp/freecode.tar.gz -C /opt/freecode \
 && ln -s /opt/freecode/freecode /usr/local/bin/freecode \
 && rm /tmp/freecode.tar.gz

# Trials run --user <uid>:<gid> of the operator, so HOME must be writable by
# anyone. Agent CLIs write their config/state here and it dies with the
# container — which is the point: no memory carried between trials (§6.3).
RUN mkdir -p /tmp/agent-home && chmod 777 /tmp/agent-home
ENV HOME=/tmp/agent-home

WORKDIR /workspace
