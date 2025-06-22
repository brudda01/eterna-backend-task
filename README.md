# Meme Coin Aggregator API

A real-time meme coin data aggregation service that combines data from DexScreener and GeckoTerminal APIs with WebSocket support for live updates.

## 🚀 Features

- **Multi-source data aggregation** from DexScreener and GeckoTerminal
- **Real-time WebSocket updates** with smart change detection
- **Redis caching** with 30-second TTL
- **Time period filtering** (1h, 24h, 7d) with period-specific data
- **Rate limiting** with exponential backoff retry logic
- **Cursor-based pagination** for efficient data retrieval
- **Health monitoring** and error handling
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
- `GET /health/detailed` - Detailed health with Redis latency, memory usage, WebSocket stats

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
  "data": [
    {
      "token_address": "HMPMa68Zzbx13g3KomQJiH9k9ito9eiUKi4sEEU2pump",
      "token_name": "Example Token",
      "token_ticker": "EXAMPLE",
      "price_sol": 0.001,
      "volume_24h": 50000,
      "volume_sol": 50000,
      "transaction_count_24h": 1500,
      "transaction_count": 1500,
      "market_cap_sol": 1000000,
      "protocol": "DexScreener+GeckoTerminal"
    }
  ],
  "pagination": {
    "hasNext": true,
    "nextCursor": "token_address_for_next_page"
  }
}
```

**Single Token Response:**
```json
{
  "data": {
    "token_address": "HMPMa68Zzbx13g3KomQJiH9k9ito9eiUKi4sEEU2pump",
    "token_name": "Example Token",
    "token_ticker": "EXAMPLE",
    "price_sol": 0.001,
    "volume_24h": 50000,
    "market_cap_sol": 1000000,
    "protocol": "DexScreener+GeckoTerminal"
  }
}
```

**Refresh Response:**
```json
{
  "data": [
    {
      "token_address": "HMPMa68Zzbx13g3KomQJiH9k9ito9eiUKi4sEEU2pump",
      "token_name": "Example Token",
      "volume_24h": 50000
    }
  ],
  "message": "Tokens refreshed successfully",
  "count": 25,
  "changedCount": 5,
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

### WebSocket Client Commands

- **SUBSCRIBE**: Subscribe to updates (currently all clients get all updates)
- **UNSUBSCRIBE**: Unsubscribe from updates
- **PING**: Test connection (server responds with pong)

### UPDATE Message Structure

```json
{
  "type": "UPDATE",
  "data": {
    "tokens": [
      {
        "token_address": "HMPMa68Zzbx13g3KomQJiH9k9ito9eiUKi4sEEU2pump",
        "token_name": "Example Token",
        "price_sol": 0.001,
        "volume_24h": 50000
      }
    ],
    "source": "scheduler",
    "updateType": "changed",
    "count": 5,
    "timestamp": "2024-01-01T12:00:00.000Z"
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Change Detection Criteria

The system detects meaningful changes using these thresholds:
- **Price**: 2% change in SOL price
- **Volume**: 10% change in 24h volume, 20% change in 1h volume
- **Market Cap**: 5% change
- **Transactions**: 10% change in 24h transactions, 20% change in 1h transactions

Only tokens meeting these change thresholds are included in UPDATE messages.

### Connection Features

- **Automatic heartbeat**: Server pings every 30 seconds to detect dead connections
- **Connection cleanup**: Dead connections are automatically removed
- **Error handling**: Robust error handling with proper cleanup
- **Connection stats**: Available via `/health/detailed` endpoint
- **Efficient updates**: Only changed tokens sent in UPDATE messages
- **Single message type**: All communications use the UPDATE message type

## 📊 Data Sources & Coverage

- **DexScreener**: 300 requests/minute - Primary meme token search
- **GeckoTerminal**: 30 requests/minute - Token enrichment

### Search Strategy
The service uses multiple meme-specific search terms:
- `meme`, `pepe`, `doge`, `shib`, `bonk`, `floki`, `wojak`, `moon`, `hodl`

### Data Merging
- **Volume & Transactions**: Summed from both sources
- **Market Cap & Liquidity**: Higher value selected
- **Price**: GeckoTerminal preferred when available and non-zero
- **Protocol**: Indicates merged data source (`DexScreener+GeckoTerminal`)

## 🗄️ Caching Strategy

### Cache Levels
1. **Complete Dataset**: `tokens:all` - Full unfiltered token list
2. **Individual Tokens**: `token:{address}` - For direct lookups and change detection
3. **Filtered Results**: Common filter patterns cached

### Cache Configuration
- **TTL**: 30 seconds to balance freshness with API rate limits
- **Keys**: `tokens:{period}:{sortBy}:{limit}` for filtered results

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

The service provides health monitoring:

- **Basic Health**: `GET /health` - Service status and uptime
- **Detailed Health**: `GET /health/detailed` - Redis latency, memory usage, WebSocket stats
- **Request Logging**: All requests logged with duration and status codes
- **Error Tracking**: Error logging with stack traces

## 🏗️ Architecture & Design Decisions

### System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   DexScreener   │    │  GeckoTerminal   │    │     Redis       │
│   (9 Queries)   │    │   (Enrichment)   │    │     Cache       │
└─────────┬───────┘    └─────────┬────────┘    └─────────┬───────┘
          │                      │                       │
          └──────────┬───────────┘                       │
                     │                                   │
          ┌──────────▼───────────┐                       │
          │   Token Service      │◄──────────────────────┘
          │  (Data Merging &     │
          │   Change Detection)  │
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

### 🎯 Design Decisions

#### **Data Sources**
- **DexScreener**: Primary source for meme token search with multiple query terms
- **GeckoTerminal**: Secondary enrichment for additional data
- **Merge Strategy**: Sum volumes/transactions, use higher values for market cap/liquidity

#### **Caching**
- **Redis**: 30-second TTL to balance freshness vs API limits
- **Multi-level**: Complete dataset + individual tokens + filtered combinations
- **Cache Keys**: `tokens:{period}:{sortBy}:{limit}` for filtered results

#### **Change Detection**
- **Thresholds**: 2% price, 10-20% volume, 5% market cap changes
- **Purpose**: Only broadcast meaningful updates via WebSocket
- **Comparison**: Before/after state comparison to detect changes

#### **WebSocket Design**
- **Single Message Type**: UPDATE for all communications
- **Heartbeat**: 30-second ping/pong for connection health
- **Change-Only**: Only send tokens with significant changes

#### **Rate Limiting**
- **DexScreener**: 300 requests/minute
- **GeckoTerminal**: 30 requests/minute  
- **Retry Logic**: Exponential backoff with configurable parameters

#### **API Structure**
- **Generic**: `/api/tokens` with flexible filtering
- **Specialized**: `/trending`, `/volume` for common use cases
- **Pagination**: Cursor-based for large datasets

### 🔄 Data Flow

1. **Scheduled Updates** (every 10 seconds):
   - Fetch from DexScreener with multiple search queries
   - Extract and validate Solana addresses
   - Enrich with GeckoTerminal data
   - Compare against previous state for changes
   - Cache at multiple levels
   - Broadcast only changed tokens via WebSocket

2. **API Requests**:
   - Check specific filter cache first
   - Fallback to complete cache with filtering
   - Apply cursor-based pagination
   - Return results with metadata

## 🔄 Scheduled Updates

The service automatically updates token data every 10 seconds, providing:
- Fresh token data from multiple sources
- Real-time WebSocket notifications for significant changes only
- Cache refresh across all levels

## 🚨 Error Handling

The service implements robust error handling:

- **Exponential Backoff**: Retry logic for API failures with configurable parameters
- **Graceful Degradation**: Service continues with cached data when APIs are unavailable
- **Input Validation**: Validation with detailed error messages
- **Rate Limit Management**: Automatic retry scheduling
- **WebSocket Resilience**: Automatic connection cleanup and error recovery

## 🧪 Testing

```bash
# Check health
curl http://localhost:3000/health

# Check detailed health
curl http://localhost:3000/health/detailed

# Test WebSocket connection
wscat -c ws://localhost:3001

# Test manual refresh
curl -X POST http://localhost:3000/api/tokens/refresh

# Test with filters
curl "http://localhost:3000/api/tokens?period=24h&sortBy=volume&limit=5"
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