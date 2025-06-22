# Meme Coin Aggregator

Real-time meme coin data aggregation service with WebSocket support.

## Quick Start

```bash
# Install dependencies
npm install

# Start Redis (required)
docker run -d -p 6379:6379 redis:alpine

# Run development server
npm run dev

# Or build and run production
npm run build
npm start
```

## API Endpoints

- `GET /api/tokens` - Get all tokens (with filters)
- `GET /api/tokens/:address` - Get specific token
- `GET /api/tokens/trending` - Get trending tokens
- `POST /api/tokens/refresh` - Refresh token data
- `GET /health` - Health check
- `ws://localhost:3001` - WebSocket for real-time updates

## Query Parameters

- `period`: 1h, 24h, 7d
- `sortBy`: volume, price_change, market_cap
- `limit`: number of results (default: 20)

## Environment Variables

```
PORT=3000
WS_PORT=3001
REDIS_URL=redis://localhost:6379
CACHE_TTL=30
```

## Features

- Real-time data from DexScreener, Jupiter APIs
- Redis caching with 30s TTL
- WebSocket price updates
- Rate limiting with exponential backoff
- Token merging from multiple sources
- Cursor-based pagination

## Architecture

- Express.js REST API
- WebSocket server for real-time updates
- Redis for caching
- Node-cron for scheduled updates
- TypeScript for type safety 