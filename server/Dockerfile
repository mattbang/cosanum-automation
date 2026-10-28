FROM node:24-slim
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /app
COPY server ./server
COPY mobile ./mobile
COPY contracts ./contracts
COPY fixtures ./fixtures
WORKDIR /app/server
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/http.ts"]
