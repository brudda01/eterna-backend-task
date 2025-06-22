import WebSocket from 'ws';
import { config } from '../config';
import { Token, WebSocketMessage } from '../types';

export class WebSocketServer {
  private wss: WebSocket.Server;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.wss = new WebSocket.Server({ 
      port: config.wsPort,
      maxPayload: 16 * 1024 * 1024, // 16MB max message size
    });
    this.setupEventHandlers();
    this.startHeartbeat();
  }

  private setupEventHandlers(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`New WebSocket connection. Total connections: ${this.clients.size + 1}`);
      this.clients.add(ws);

      // Add connection metadata
      (ws as any).isAlive = true;
      (ws as any).connectedAt = new Date();

      ws.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('Invalid WebSocket message:', error instanceof Error ? error.message : String(error));
          this.sendToClient(ws, {
            type: 'UPDATE',
            data: { error: 'Invalid message format' },
            timestamp: new Date().toISOString()
          });
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}. Remaining: ${this.clients.size - 1}`);
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        this.clients.delete(ws);
      });

      // Handle pong responses for heartbeat
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      // Send welcome message with current status
      this.sendToClient(ws, {
        type: 'UPDATE',
        data: {
          message: 'Connected to Meme Coin Aggregator',
          connectedClients: this.clients.size,
          serverTime: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket Server error:', error);
    });
  }

  private handleMessage(ws: WebSocket, message: any): void {
    console.log(message);
    // Validate message structure
    if (!message || typeof message !== 'object' || !message.type) {
      this.sendToClient(ws, {
        type: 'UPDATE',
        data: { error: 'Message must have a type field' },
        timestamp: new Date().toISOString()
      });
      return;
    }

    switch (message.type) {
      case 'SUBSCRIBE':
        this.handleSubscribe(ws, message);
        break;
      case 'UNSUBSCRIBE':
        this.handleUnsubscribe(ws, message);
        break;
      case 'PING':
        this.sendToClient(ws, {
          type: 'UPDATE',
          data: { pong: true, serverTime: new Date().toISOString() },
          timestamp: new Date().toISOString()
        });
        break;
      default:
        console.log('Unknown message type:', message.type);
        this.sendToClient(ws, {
          type: 'UPDATE',
          data: { error: `Unknown message type: ${message.type}` },
          timestamp: new Date().toISOString()
        });
    }
  }

  private handleSubscribe(ws: WebSocket, message: any): void {
    // For now, all clients are automatically subscribed to all updates
    // In the future, this could handle specific token subscriptions
    const subscriptionType = message.subscription || 'all';
    
    console.log(`Client subscribed to: ${subscriptionType}`);
    this.sendToClient(ws, {
      type: 'UPDATE',
      data: { 
        subscribed: true, 
        subscription: subscriptionType,
        message: 'Subscribed to token updates'
      },
      timestamp: new Date().toISOString()
    });
  }

  private handleUnsubscribe(ws: WebSocket, message: any): void {
    const subscriptionType = message.subscription || 'all';
    
    console.log(`Client unsubscribed from: ${subscriptionType}`);
    this.sendToClient(ws, {
      type: 'UPDATE',
      data: { 
        unsubscribed: true, 
        subscription: subscriptionType,
        message: 'Unsubscribed from token updates'
      },
      timestamp: new Date().toISOString()
    });
  }

  private startHeartbeat(): void {
    // Send ping every 30 seconds to detect dead connections
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: WebSocket) => {
        if ((ws as any).isAlive === false) {
          console.log('Terminating dead WebSocket connection');
          this.clients.delete(ws);
          return ws.terminate();
        }

        (ws as any).isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  broadcast(message: WebSocketMessage): void {
    if (this.clients.size === 0) {
      return; // No clients to broadcast to
    }

    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let errorCount = 0;
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          successCount++;
        } catch (error) {
          console.error('Error broadcasting to client:', error instanceof Error ? error.message : String(error));
          this.clients.delete(client);
          errorCount++;
        }
      } else {
        // Remove clients that are not in OPEN state
        this.clients.delete(client);
        errorCount++;
      }
    });

    if (errorCount > 0) {
      console.log(`Broadcast completed: ${successCount} success, ${errorCount} errors/removed`);
    }
  }

  broadcastUpdate(changedTokens: Token[], source: string = 'system'): void {
    if (changedTokens.length === 0) return;

    this.broadcast({
      type: 'UPDATE',
      data: {
        tokens: changedTokens,
        source: source, // 'scheduler' or 'manual' or 'system'
        updateType: 'changed', // indicates this contains only changed tokens
        count: changedTokens.length,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

    console.log(`Broadcasted ${changedTokens.length} changed tokens (source: ${source}) to ${this.clients.size} clients`);
  }

  private sendToClient(client: WebSocket, message: WebSocketMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending message to client:', error instanceof Error ? error.message : String(error));
        this.clients.delete(client);
      }
    }
  }

  getConnectedClients(): number {
    return this.clients.size;
  }

  getConnectionStats(): { total: number; details: any[] } {
    const details = Array.from(this.clients).map(client => ({
      readyState: client.readyState,
      isAlive: (client as any).isAlive,
      connectedAt: (client as any).connectedAt
    }));

    return {
      total: this.clients.size,
      details
    };
  }

  close(): void {
    console.log('Closing WebSocket server...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, 'Server shutting down');
      }
    });
    
    this.wss.close(() => {
      console.log('WebSocket server closed');
    });
  }
} 