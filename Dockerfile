FROM golang:1.23-bookworm AS build

WORKDIR /src

COPY go.mod ./
COPY server ./server

RUN go build -o /out/underlow ./server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends clang ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /out/underlow /usr/local/bin/underlow
COPY index.html ./
COPY src ./src
COPY content ./content

ENV HOST=0.0.0.0
ENV PORT=8121
ENV UNDERLOW_ROOT=/app

EXPOSE 8121

CMD ["underlow"]
