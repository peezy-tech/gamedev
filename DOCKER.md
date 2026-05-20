# 🐳 Docker Deployment

The project can be run using Docker. Make sure you have Docker installed on your system.

1. Build the image and run the container:

```bash
docker build -t hyperfydemo . && docker run -d -p 3000:3000 \
  -v "$(pwd)/src:/app/src" \
  -v "$(pwd)/world:/app/world" \
  -v "$(pwd)/.env:/app/.env" \
  -e DOMAIN=demo.hyperfy.host \
  -e PORT=3000 \
  -e ASSETS_DIR=/world/assets \
  -e PUBLIC_WS_URL=https://demo.hyperfy.host/ws \
  -e PUBLIC_API_URL=https://demo.hyperfy.host/api \
  -e PUBLIC_AUTH_URL=https://demo.hyperfy.host/api/auth/identity \
  -e STANDALONE_WALLET_AUTH=true \
  -e PUBLIC_REQUIRE_WALLET_AUTH=true \
  -e CORS_ORIGINS=https://games.example \
  -e ASSETS_BASE_URL=https://demo.hyperfy.host/assets \
  hyperfydemo
```

To store uploaded app scripts and world assets in protocol `asset-service`, set:

```bash
-e ASSETS=asset-service \
-e ASSETS_BASE_URL=https://demo.hyperfy.host/assets \
-e ASSET_SERVICE_URL=http://asset-service:8787 \
-e ASSET_SERVICE_API_KEY=change-me
```

With `ASSETS=asset-service`, keep `ASSETS_BASE_URL` on the runtime `/assets`
route. The runtime serves packaged engine assets such as `avatar.vrm` itself and
proxies content-addressed uploads to `asset-service`.

This command:
- Builds the Docker image tagged as 'hyperfydemo'
- Mounts local src/, world/ directories and .env file into the container
- Exposes port 3000
- Sets up required environment variables
- Runs the container in detached mode (-d)

Note: Adjust the URLs and domain according to your specific setup.
