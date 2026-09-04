# Railway does not resolve Git LFS during its build, so public/*.db and
# public/*.pmtiles would otherwise arrive as unresolved pointer stubs. This
# clones the repo fresh and runs `git lfs pull` itself to get the real files.

FROM node:20-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install

WORKDIR /src

# Cache-bust: without this, a broken clone (e.g. one hitting a transient LFS
# fetch failure) gets cached as a "successful" layer forever, since the RUN
# commands below never change on their own. RAILWAY_GIT_COMMIT_SHA changes
# on every deploy, so it forces a fresh clone + LFS pull each time.
ARG RAILWAY_GIT_COMMIT_SHA=unknown
RUN echo "cache-bust: ${RAILWAY_GIT_COMMIT_SHA}" > /tmp/cachebust

RUN git clone --depth 1 https://github.com/jacksungmin/hsip.git .
RUN git lfs pull

# Fail here, loudly, rather than shipping pointer stubs that only surface as
# a runtime error for users (see: "Git LFS pointer served instead of binary"
# on a prior deploy).
RUN for f in public/*.db public/*.pmtiles; do \
      size=$(stat -c%s "$f"); \
      if [ "$size" -lt 1000000 ]; then \
        echo "ERROR: $f is only $size bytes - looks like an unresolved Git LFS pointer, not real data" >&2; \
        exit 1; \
      fi; \
    done

RUN npm ci
RUN npx vite build

FROM node:20-slim
RUN npm install -g serve
COPY --from=build /src/dist /app/dist
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "serve -s /app/dist -l ${PORT}"]
