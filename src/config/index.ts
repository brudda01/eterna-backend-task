export const config = {
  port: parseInt(process.env.PORT || '3000'),
  wsPort: parseInt(process.env.WS_PORT || '3001'),
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttl: parseInt(process.env.CACHE_TTL || '30') // seconds
  },
  
  apis: {
    dexscreener: {
      baseUrl: 'https://api.dexscreener.com/latest/dex',
      rateLimit: 300 // per minute
    },
    geckoterminal: {
      baseUrl: 'https://api.geckoterminal.com/api/v2',
      rateLimit: 30 // per minute (free tier)
    }
  },
  
  scheduler: {
    updateInterval: '*/10 * * * * *' // Update tokens every 10 seconds
  },
  
  rateLimits: {
    apiCallsPerSecond: 5,
    backoffMultiplier: 2,
    maxRetries: 3
  }
}; 