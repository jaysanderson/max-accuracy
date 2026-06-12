# Static PWA image: the app is fully client-side; we ship the pre-built dist/
# behind nginx. Build locally with `npm run build` before `fly deploy`.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 80
