import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import createTokenRoutes from './routes/token-routes';
import { WebSocketServer } from './websocket/websocket-server';
import { TokenService } from './services/token-service';
import { TokenScheduler } from './scheduler/token-scheduler';
import { CacheManager } from './cache/redis';

class Server {
  private app: express.Application;
  private wsServer: WebSocketServer;
  private tokenService: TokenService;
  private scheduler: TokenScheduler;
  private cache: CacheManager;

  constructor() {
    this.app = express();
    this.cache = new CacheManager();
    this.tokenService = new TokenService();
    this.wsServer = new WebSocketServer();
    this.scheduler = new TokenScheduler(this.tokenService, this.wsServer);
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging middleware
    this.app.use((req, res, next) => {
      const start = Date.now();
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
      });
      
      next();
    });
  }

  private setupRoutes(): void {
    // Health check with dependency checks
    this.app.get('/health', async (req, res) => {
      try {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          wsConnections: this.wsServer.getConnectedClients(),
          services: {
            redis: 'unknown',
            dexscreener: 'unknown',
            geckoterminal: 'unknown'
          }
        };

        // Check Redis connection
        try {
          await this.cache.get('health-check');
          health.services.redis = 'healthy';
        } catch (error) {
          health.services.redis = 'unhealthy';
          health.status = 'degraded';
        }

        // For API health, we could add simple ping endpoints, but for now just mark as healthy
        health.services.dexscreener = 'healthy';
        health.services.geckoterminal = 'healthy';

        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        console.error('Health check error:', error);
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed'
        });
      }
    });

    // Detailed health check
    this.app.get('/health/detailed', async (req, res) => {
      try {
        const wsStats = this.wsServer.getConnectionStats();
        const detailedHealth = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          websocket: {
            totalConnections: wsStats.total,
            connectionDetails: wsStats.details
          },
          services: {
            redis: { status: 'unknown', latency: 0 },
            apis: {
              dexscreener: { status: 'healthy', rateLimit: config.apis.dexscreener.rateLimit },
              geckoterminal: { status: 'healthy', rateLimit: config.apis.geckoterminal.rateLimit }
            }
          }
        };

        // Test Redis with latency
        const redisStart = Date.now();
        try {
          await this.cache.get('health-check');
          detailedHealth.services.redis = {
            status: 'healthy',
            latency: Date.now() - redisStart
          };
        } catch (error) {
          detailedHealth.services.redis = {
            status: 'unhealthy',
            latency: Date.now() - redisStart
          };
          detailedHealth.status = 'degraded';
        }

        const statusCode = detailedHealth.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(detailedHealth);
      } catch (error) {
        console.error('Detailed health check error:', error);
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Detailed health check failed'
        });
      }
    });

    // API routes - pass WebSocket server to token routes
    this.app.use('/api/tokens', createTokenRoutes(this.wsServer));

    // Default route
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Meme Coin Aggregator API',
        version: '1.0.0',
        endpoints: {
          tokens: '/api/tokens',
          health: '/health',
          detailedHealth: '/health/detailed',
          websocket: `ws://localhost:${config.wsPort}`
        },
        documentation: {
          tokens: {
            'GET /api/tokens': 'Get all tokens with optional filters (period, sortBy, limit, cursor)',
            'GET /api/tokens/trending': 'Get trending tokens sorted by price change',
            'GET /api/tokens/volume': 'Get tokens sorted by volume',
            'GET /api/tokens/:address': 'Get specific token by address',
            'POST /api/tokens/refresh': 'Refresh token data from APIs'
          }
        }
      });
    });
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.use((req: express.Request, res: express.Response) => {
      res.status(404).json({ 
        error: 'Route not found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Test Redis connection before starting
      console.log('Testing Redis connection...');
      try {
        await this.cache.get('startup-test');
        console.log('✅ Redis connection successful');
      } catch (error) {
        console.error('❌ Redis connection failed:', error instanceof Error ? error.message : String(error));
        console.log('⚠️  Continuing without Redis - caching will be disabled');
      }

      // Start Express server
      this.app.listen(config.port, () => {
        console.log(`🚀 REST API server running on port ${config.port}`);
      });

      // Start WebSocket server
      console.log(`🔌 WebSocket server running on port ${config.wsPort}`);

      // Start scheduler
      this.scheduler.start();

      // Handle graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

      console.log('✅ Server started successfully');
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  private async shutdown(): Promise<void> {
    console.log('🛑 Shutting down server...');
    
    try {
      this.scheduler.stop();
      this.wsServer.close();
      await this.cache.disconnect();
      console.log('✅ Server shutdown complete');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
    
    process.exit(0);
  }
}

const server = new Server();
server.start().catch(error => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});