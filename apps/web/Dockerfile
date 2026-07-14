# 1) 빌드 단계 — Vite(React) → 정적 파일(dist)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
# 브라우저가 백엔드를 호출할 공개 주소 (빌드 시점에 번들에 박힘).
# 로컬 기본값은 localhost:8000, 배포 VM에선 build arg로 http://<공개IP> 주입.
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# 2) 서빙 단계 — nginx가 정적 파일 + /api·/ws 프록시
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
