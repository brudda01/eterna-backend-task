import * as cron from 'node-cron';
import { TokenService } from '../services/token-service';
import { WebSocketServer } from '../websocket/websocket-server';
import { config } from '../config';

export class TokenScheduler {
  private tokenService: TokenService;
  private wsServer: WebSocketServer;

  constructor(tokenService: TokenService, wsServer: WebSocketServer) {
    this.tokenService = tokenService;
    this.wsServer = wsServer;
  }

  start(): void {
    console.log('Starting token scheduler...');

    // Hot tokens update every 30 seconds
    cron.schedule(config.scheduler.hotTokens, async () => {
      await this.updateHotTokens();
    });

    // Regular tokens update every 2 minutes
    cron.schedule(config.scheduler.regularTokens, async () => {
      await this.updateRegularTokens();
    });

    // Cold tokens update every 10 minutes
    cron.schedule(config.scheduler.coldTokens, async () => {
      await this.updateColdTokens();
    });

    console.log('Token scheduler started');
  }

  private async updateHotTokens(): Promise<void> {
    try {
      console.log('Updating hot tokens...');
      const tokens = await this.tokenService.refreshTokens();
      
      // Detect price changes
      const changedTokens = await this.tokenService.detectPriceChanges(tokens);
      
      if (changedTokens.length > 0) {
        console.log(`Broadcasting ${changedTokens.length} price updates`);
        this.wsServer.broadcastPriceUpdate(changedTokens);
      }
    } catch (error) {
      console.error('Hot tokens update error:', error);
    }
  }

  private async updateRegularTokens(): Promise<void> {
    try {
      console.log('Updating regular tokens...');
      const tokens = await this.tokenService.refreshTokens();
      
      // Check for significant volume changes
      const volumeChanges = tokens.filter(token => 
        token.volume_24h > 1000 // Example threshold
      );
      
      if (volumeChanges.length > 0) {
        this.wsServer.broadcastVolumeUpdate(volumeChanges);
      }
    } catch (error) {
      console.error('Regular tokens update error:', error);
    }
  }

  private async updateColdTokens(): Promise<void> {
    try {
      console.log('Updating cold tokens...');
      await this.tokenService.refreshTokens();
      console.log('Cold tokens updated');
    } catch (error) {
      console.error('Cold tokens update error:', error);
    }
  }

  stop(): void {
    cron.getTasks().forEach(task => task.stop());
    console.log('Token scheduler stopped');
  }
}