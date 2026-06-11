FROM node:20-alpine
WORKDIR /app
COPY worker-service/package.json ./
RUN npm install --omit=dev
COPY config ./config
COPY worker-service/src ./src
CMD ["npm", "start"]
