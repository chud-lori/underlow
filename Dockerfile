FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends clang ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY index.html ./
COPY server ./server
COPY src ./src
COPY content ./content

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8121

EXPOSE 8121

CMD ["npm", "run", "server"]
