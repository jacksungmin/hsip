# Railway does not resolve Git LFS during its build, so public/*.db and
# public/*.pmtiles would otherwise arrive as unresolved pointer stubs. This
# clones the repo fresh and runs `git lfs pull` itself to get the real files.

FROM node:20-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install

WORKDIR /src
RUN git clone --depth 1 https://github.com/jacksungmin/hsip.git .
RUN git lfs pull

RUN npm ci
RUN npx vite build

FROM node:20-slim
RUN npm install -g serve
COPY --from=build /src/dist /app/dist
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "serve -s /app/dist -l ${PORT}"]
