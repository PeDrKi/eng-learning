# Image chạy tuvung-api trên Fly.io (xem DEPLOY.md, phần "Không dùng GitHub").
# Chỉ chứa mã chạy (src, migrations) và thư viện production — không có test, .env hay node_modules máy dev.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
# Không chạy bằng root: lỗ hổng trong app (nếu có) không chiếm được cả máy.
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
