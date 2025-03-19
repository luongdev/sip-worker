FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    iproute2 vim net-tools \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

RUN mkdir -p /opt/node_modules
RUN npm config set cache /opt/npm-cache

WORKDIR /workspace

ENV NODE_ENV=development
ENV PATH=$PATH:/workspace/sdk/node_modules/.bin:/workspace/nss/node_modules/.bin

CMD ["bash"] 