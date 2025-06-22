import WebSocket from 'ws';
import { config } from '../config';
import { Token, WebSocketMessage } from '../types';

export class WebSocketServer {
  private wss: WebSocket.Server;
  private clients: Set<WebSocket> = new Set();

  constructor() {
    this.wss = new WebSocket.Server({ port: config.wsPort });
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection');
      this.clients.add(ws);

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Send initial connection message
      this.sendToClient(ws, {
        type: 'PRICE_UPDATE',
        data: [],
        timestamp: new Date().toISOString()
      });
    });
  }

  private handleMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'SUBSCRIBE':
        // Handle subscription logic
        break;
      case 'UNSUBSCRIBE':
        // Handle unsubscription logic
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  broadcast(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  broadcastPriceUpdate(tokens: Token[]): void {
    this.broadcast({
      type: 'PRICE_UPDATE',
      data: tokens,
      timestamp: new Date().toISOString()
    });
  }

  broadcastVolumeUpdate(tokens: Token[]): void {
    this.broadcast({
      type: 'VOLUME_UPDATE',
      data: tokens,
      timestamp: new Date().toISOString()
    });
  }

  private sendToClient(client: WebSocket, message: WebSocketMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  getConnectedClients(): number {
    return this.clients.size;
  }

  close(): void {
    this.clients.forEach(client => {
      client.close();
    });
    this.wss.close();
  }
} 