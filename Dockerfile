# SemText — static marketing site (semtext.dev) + component demos, served by nginx.
#
# Two stages:
#   builder     — node, runs `npm ci && npm run build` to produce dist/
#   production  — nginx:alpine serving dist/site at / and dist/demo at /demo/
#
# The final stage MUST be named "production" — the fleet build tooling targets
# that stage name by contract (same as elixirgenai.dev, pos.noizu.com, ...).

FROM node:22-alpine AS builder
WORKDIR /app

# Cypress is a devDependency but its binary is only needed for the e2e suite,
# never for `npm run build`. Skip the ~200MB download in the image build.
ENV CYPRESS_INSTALL_BINARY=0

COPY package.json package-lock.json ./
# npm's download cache survives lockfile changes (the layer itself does not).
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Marketing site is the web root; component demos live under /demo/.
COPY --from=builder /app/dist/site/ /usr/share/nginx/html/
COPY --from=builder /app/dist/demo/ /usr/share/nginx/html/demo/

# Standalone spec page (dist/spec/conventions.html, built by
# scripts/build-standalone.mjs) expects to be served from the dist ROOT: its
# relative refs are ../semtext.js, ../semtext.css and ../themes/*.css from
# /spec/, plus a
# same-dir spec.css. Ship those alongside the site root so the spec page
# doesn't silently fall through nginx's SPA `try_files` to the landing page.
COPY --from=builder /app/dist/spec/ /usr/share/nginx/html/spec/
COPY --from=builder /app/dist/themes/ /usr/share/nginx/html/themes/
# dist root artifacts: the core bundle + css AND the namespace/lazy/CLI
# bundles and their manifests this integration ships (npl.js, npl-lazy.js,
# semtext-lazy.js, semtext-js-shell.js, semtext-agent.js, semtext-manifest.json,
# npl-manifest.json, semtext-js-shell-manifest.json) plus their code-split
# chunk dirs — served pages reference them relatively and would 404 otherwise.
COPY --from=builder /app/dist/*.js /usr/share/nginx/html/
COPY --from=builder /app/dist/*.css /usr/share/nginx/html/
COPY --from=builder /app/dist/*.json /usr/share/nginx/html/
COPY --from=builder /app/dist/chunks/ /usr/share/nginx/html/chunks/
COPY --from=builder /app/dist/npl-chunks/ /usr/share/nginx/html/npl-chunks/

# Runtime GA4 injection. The built landing page carries an inert marker
# comment; the entrypoint hook rewrites the served copy from this pristine
# template on every container start (nginx:alpine runs /docker-entrypoint.d/*.sh
# before nginx). GA_MEASUREMENT_ID is therefore a deploy-time helm value, not
# something baked into an image sha — unset means no analytics at all.
COPY --from=builder /app/dist/site/index.html /usr/share/nginx/templates/index.html
COPY docker/20-ga-measurement-id.sh /docker-entrypoint.d/20-ga-measurement-id.sh
RUN chmod +x /docker-entrypoint.d/20-ga-measurement-id.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
