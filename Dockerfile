# Leaf — production image.
#
# The envelope for a bundle CI has already built, as Ship's and Peek's are:
# `publish` in deploy.yml runs `npm run build` with the three VITE_ values, which
# writes dist/, and this copies it behind nginx. The values are baked into the
# bundle, not read at runtime, because the relay URL *is* the workspace. Built
# without them the bundle runs alone and offers no sign-in.
#
# Served at the document root of its own hostname, `leaf.estiva.app`.

FROM nginx:1.27-alpine AS runtime

COPY dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Distinguishes "nginx is up" from "nginx is up and the bundle is actually in
# the image": a COPY that silently moved would otherwise deploy a 404 and
# report healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
