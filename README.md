# Meme Coin Aggregator API

A real-time meme coin data aggregation service that combines data from DexScreener and GeckoTerminal APIs to provide comprehensive token information with WebSocket support for live updates.

## 🚀 Features

- **Multi-source data aggregation** from DexScreener and GeckoTerminal
- **Real-time WebSocket updates** for price and volume changes
- **Intelligent data merging** with duplicate token handling
- **Redis caching** with 30-second TTL for performance
- **Time period filtering** (1h, 24h, 7d) with period-specific data
- **Rate limiting** with exponential backoff retry logic
- **Cursor-based pagination** for efficient data retrieval
- **Comprehensive error handling** and health monitoring
- **Input validation** and robust API design

## 🛠️ Tech Stack

- **Node.js** with **TypeScript**
- **Express.js** for REST API
- **WebSocket (ws)** for real-time updates
- **Redis** (ioredis) for caching
- **Axios** for HTTP requests
- **node-cron** for scheduled tasks
- **Security & Performance**: helmet, cors, compression

## 📋 Prerequisites

- Node.js 18+ 
- Redis server (local or remote)
- npm or yarn

## 🔧 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd eterna-backend-task
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   # Copy the example environment file
   cp env.example .env
   
   # Edit .env with your configuration
   nano .env
   ```

4. **Configure Redis**
   
   **Option A: Local Redis**
   ```bash
   # Install Redis (Ubuntu/Debian)
   sudo apt update
   sudo apt install redis-server
   
   # Start Redis
   sudo systemctl start redis-server
   sudo systemctl enable redis-server
   
   # Test Redis connection
   redis-cli ping
   ```
   
   **Option B: Redis Cloud/Remote**
   ```bash
   # Update .env with your Redis URL
   REDIS_URL=redis://username:password@host:port
   ```

5. **Build and Start**
   ```bash
   # Development mode
   npm run dev
   
   # Production build
   npm run build
   npm start
   ```

## 🔌 API Endpoints

### Root & Health Check
- `GET /` - API information and documentation
- `GET /health` - Basic health status
- `GET /health/detailed` - Detailed health with dependency status

### Token Endpoints
- `GET /api/tokens` - Get all tokens with optional filters
- `GET /api/tokens/trending` - Get trending tokens (sorted by price change)
- `GET /api/tokens/volume` - Get tokens by volume
- `GET /api/tokens/:address` - Get specific token by address
- `POST /api/tokens/refresh` - Manually refresh token data

### Query Parameters

**For `/api/tokens`:**
- `period` - Time period filter (`1h`, `24h`, `7d`)
- `sortBy` - Sort criteria (`volume`, `price_change`, `market_cap`)
- `limit` - Number of results (1-100, default: 20)
- `cursor` - Cursor for pagination

**For `/api/tokens/trending`:**
- `limit` - Number of results (1-50, default: 10)

**For `/api/tokens/volume`:**
- `limit` - Number of results (1-50, default: 20)
- `period` - Time period filter (`1h`, `24h`, `7d`)

### Example Requests

```bash
# Get top 10 tokens by 24h volume
curl "http://localhost:3000/api/tokens?sortBy=volume&period=24h&limit=10"

# Get trending tokens
curl "http://localhost:3000/api/tokens/trending?limit=5"

# Get specific token
curl "http://localhost:3000/api/tokens/HMPMa68Zzbx13g3KomQJiH9k9ito9eiUKi4sEEU2pump"

# Health check
curl "http://localhost:3000/health"

# Refresh token data manually
curl -X POST "http://localhost:3000/api/tokens/refresh"
```

### API Response Format

**Token List Response:**
```json
{
  "data": [...], // Array of token objects
  "pagination": {
    "hasNext": true,
    "nextCursor": "token_address_for_next_page"
  }
}
```

**Single Token Response:**
```json
{
  "data": { ... } // Single token object
}
```

**Refresh Response:**
```json
{
  "data": [...], // Array of refreshed tokens
  "message": "Tokens refreshed successfully",
  "count": 25, // Total tokens updated
  "changedCount": 5, // Tokens with significant changes
  "websocketBroadcast": "5 changed tokens sent to WebSocket clients"
}
```

## 🔄 WebSocket Connection

Connect to `ws://localhost:3001` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
  console.log('Connected to Meme Coin Aggregator');
  
  // Optional: Subscribe to specific updates
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    subscription: 'all' // or specific token address
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
  
  switch (message.type) {
    case 'UPDATE':
      // Token data update (includes all changes: price, volume, market cap, transactions, etc.)
      console.log('Token update:', message.data);
      console.log(`Updated ${message.data.count} tokens from ${message.data.source}`);
      break;
  }
});

ws.on('close', (code, reason) => {
  console.log(`Connection closed: ${code} - ${reason}`);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Send ping to test connection
ws.send(JSON.stringify({ type: 'PING' }));
```

### WebSocket Message Types

- **UPDATE**: The single message type for all WebSocket communications
  - Token data updates containing only tokens with significant changes
  - System messages (connection status, errors, ping responses)
  - Subscription confirmations and other administrative messages
  - Includes source information (scheduler/manual/system) and update metadata
  - Change detection thresholds: 0.1% price change, 5-10% volume change, 2% market cap change

### WebSocket Client Commands

- **SUBSCRIBE**: Subscribe to updates (currently all clients get all updates)
- **UNSUBSCRIBE**: Unsubscribe from updates
- **PING**: Test connection (server responds with pong)

### UPDATE Message Structure

```json
{
  "type": "UPDATE",
  "data": {
    "tokens": [...], // Array of only changed token objects
    "source": "scheduler", // or "manual"
    "updateType": "changed", // indicates this contains only changed tokens
    "count": 5, // number of changed tokens (not total tokens)
    "timestamp": "2024-01-01T12:00:00.000Z"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Change Detection Criteria

The system detects meaningful changes using these thresholds:
- **Price**: 0.1% change in SOL price
- **Price Changes**: 0.5% change in 1h/24h percentages, 1% change in 7d percentage  
- **Volume**: 5-10% change or minimum dollar thresholds ($100 for 1h, $1000 for 24h, $5000 for 7d)
- **Market Cap**: 2% change or minimum $10,000 change
- **Transactions**: 5-10% change or minimum transaction count thresholds

Only tokens meeting these change thresholds are included in UPDATE messages, ensuring clients receive meaningful updates without noise.

### Connection Features

- **Automatic heartbeat**: Server pings every 30 seconds to detect dead connections
- **Connection cleanup**: Dead connections are automatically removed
- **Error handling**: Robust error handling with proper cleanup
- **Connection stats**: Available via `/health/detailed` endpoint
- **Efficient updates**: Only changed tokens sent in UPDATE messages
- **Smart change detection**: Filters out noise and sends only meaningful changes
- **Single message type**: All communications use the UPDATE message type for maximum simplicity

## 📊 Data Sources & Rate Limits

- **DexScreener**: 300 requests/minute
- **GeckoTerminal**: 30 requests/minute

The service automatically handles rate limiting with exponential backoff.

## 🔧 Configuration

Environment variables (`.env`):

```env
# Server Configuration
PORT=3000
WS_PORT=3001

# Redis Configuration
REDIS_URL=redis://localhost:6379
CACHE_TTL=30

# Environment
NODE_ENV=development
```

## 📈 Monitoring & Health Checks

The service provides comprehensive health monitoring:

- **Basic Health**: `GET /health`
- **Detailed Health**: `GET /health/detailed` (includes Redis latency, memory usage, uptime)
- **Logging**: All requests are logged with duration and status codes
- **Error Tracking**: Comprehensive error logging with stack traces

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   DexScreener   │    │  GeckoTerminal   │    │     Redis       │
│      API        │    │       API        │    │     Cache       │
└─────────┬───────┘    └─────────┬────────┘    └─────────┬───────┘
          │                      │                       │
          └──────────┬───────────┘                       │
                     │                                   │
          ┌──────────▼───────────┐                       │
          │   Token Service      │◄──────────────────────┘
          │  (Data Merging &     │
          │   Filtering)         │
          └──────────┬───────────┘
                     │
          ┌──────────▼───────────┐
          │   REST API Server    │
          │  (Express.js)        │
          └──────────┬───────────┘
                     │
          ┌──────────▼───────────┐
          │  WebSocket Server    │
          │  (Real-time Updates) │
          └──────────────────────┘
```

## 🔄 Scheduled Updates

The service automatically updates token data every 5 seconds, providing:
- Fresh tokens data
- Real-time WebSocket notifications for significant changes
- Automatic cache refresh

## 🚨 Error Handling

The service implements comprehensive error handling:

- **Retry logic** with exponential backoff for API failures
- **Graceful degradation** when external services are unavailable
- **Input validation** with detailed error messages
- **Rate limit handling** with automatic retry scheduling

## 🧪 Testing

```bash
# Check health
curl http://localhost:3000/health

# Test WebSocket connection
wscat -c ws://localhost:3001
```

## 📝 Development

```bash
# Development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Check types
npx tsc --noEmit
```