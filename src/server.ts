import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import tokenRoutes from './routes/token-routes';
import { WebSocketServer } from './websocket/websocket-server';
import { TokenService } from './services/token-service';
import { TokenScheduler } from './scheduler/token-scheduler';

class Server {
  private app: express.Application;
  private wsServer: WebSocketServer;
  private tokenService: TokenService;
  private scheduler: TokenScheduler;

  constructor() {
    this.app = express();
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
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        wsConnections: this.wsServer.getConnectedClients()
      });
    });

    // API routes
    this.app.use('/api/tokens', tokenRoutes);

    // Default route
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Meme Coin Aggregator API',
        version: '1.0.0',
        endpoints: {
          tokens: '/api/tokens',
          health: '/health',
          websocket: `ws://localhost:${config.wsPort}`
        }
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });

    this.app.use((req: express.Request, res: express.Response) => {
      res.status(404).json({ error: 'Route not found' });
    });
  }

  public start(): void {
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
  }

  private shutdown(): void {
    console.log('Shutting down server...');
    this.scheduler.stop();
    this.wsServer.close();
    process.exit(0);
  }
}

const server = new Server();
server.start();