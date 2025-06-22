import * as cron from 'node-cron';
import { TokenService } from '../services/token-service';
import { WebSocketServer } from '../websocket/websocket-server';
import { config } from '../config';

export class TokenScheduler {
  private tokenService: TokenService;
  private wsServer: WebSocketServer;
  private updateTask: cron.ScheduledTask | null = null;

  constructor(tokenService: TokenService, wsServer: WebSocketServer) {
    this.tokenService = tokenService;
    this.wsServer = wsServer;
  }

  start(): void {
    console.log('Starting token scheduler...');

    // Regular token updates every 2 minutes
    this.updateTask = cron.schedule(config.scheduler.updateInterval, async () => {
      await this.updateTokens();
    });

    console.log(`Token scheduler started - updating every 10 seconds`);
  }

  private async updateTokens(): Promise<void> {
    try {
      console.log('Scheduled token update starting...');
      const startTime = Date.now();
      
      const { allTokens, changedTokens } = await this.tokenService.refreshTokens();
      
      if (allTokens.length > 0) {
        const fetchTime = Date.now() - startTime;
        console.log(`Successfully fetched ${allTokens.length} tokens in ${fetchTime}ms. Comparing against previous state...`);
        
        if (changedTokens.length > 0) {
          console.log(`Broadcasting ${changedTokens.length} changed tokens out of ${allTokens.length} total`);
          // Send only the changed tokens via WebSocket
          this.wsServer.broadcastUpdate(changedTokens, 'scheduler');
        } else {
          console.log('No significant token changes detected - no WebSocket broadcast needed');
        }
        
        console.log(`Scheduled update completed in ${Date.now() - startTime}ms - data cached and ready for API requests`);
      } else {
        console.log('No tokens updated - API may be unavailable');
      }
    } catch (error) {
      console.error('Scheduled token update error:', error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    if (this.updateTask) {
      this.updateTask.stop();
      this.updateTask = null;
    }
    console.log('Token scheduler stopped');
  }
}