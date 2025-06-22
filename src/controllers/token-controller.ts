import { Request, Response } from 'express';
import { TokenService } from '../services/token-service';
import { WebSocketServer } from '../websocket/websocket-server';
import { TokenFilters } from '../types';

export class TokenController {
  private tokenService: TokenService;
  private wsServer: WebSocketServer;

  constructor(wsServer: WebSocketServer) {
    this.tokenService = new TokenService();
    this.wsServer = wsServer;
  }

  async getTokens(req: Request, res: Response): Promise<void> {
    try {
      // Input validation
      const period = req.query.period as string;
      const sortBy = req.query.sortBy as string;
      const limit = req.query.limit as string;
      const cursor = req.query.cursor as string;

      // Validate period
      if (period && !['1h', '24h', '7d'].includes(period)) {
        res.status(400).json({ error: 'Invalid period. Must be 1h, 24h, or 7d' });
        return;
      }

      // Validate sortBy
      if (sortBy && !['volume', 'price_change', 'market_cap'].includes(sortBy)) {
        res.status(400).json({ error: 'Invalid sortBy. Must be volume, price_change, or market_cap' });
        return;
      }

      // Validate limit
      const parsedLimit = limit ? parseInt(limit) : 20;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        res.status(400).json({ error: 'Invalid limit. Must be between 1 and 100' });
        return;
      }

      const filters: TokenFilters = {
        period: period as '1h' | '24h' | '7d',
        sortBy: sortBy as 'volume' | 'price_change' | 'market_cap',
        limit: parsedLimit,
        cursor: cursor
      };

      // Returns DexScreener meme search enriched with GeckoTerminal data, filtered by time period
      const tokens = await this.tokenService.getTokens(filters);
      
      res.json({
        data: tokens,
        pagination: {
          hasNext: tokens.length === filters.limit,
          nextCursor: tokens.length > 0 ? tokens[tokens.length - 1].token_address : undefined
        }
      });
    } catch (error) {
      console.error('Get tokens error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getToken(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      
      // Validate address
      if (!address || address.length < 32 || address.length > 44) {
        res.status(400).json({ error: 'Invalid token address format' });
        return;
      }

      // Basic Solana address validation
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
      if (!base58Regex.test(address)) {
        res.status(400).json({ error: 'Invalid token address format' });
        return;
      }

      // Tries DexScreener first, then enriches with GeckoTerminal data
      const token = await this.tokenService.getToken(address);
      
      if (!token) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }
      
      res.json({ data: token });
    } catch (error) {
      console.error('Get token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async refreshTokens(req: Request, res: Response): Promise<void> {
    try {
      console.log('Manual token refresh requested');
      
      const { allTokens, changedTokens } = await this.tokenService.refreshTokens();
      
      if (allTokens.length > 0) {
        console.log(`Manual refresh completed: ${allTokens.length} tokens fetched`);
        
        if (changedTokens.length > 0) {
          console.log(`Broadcasting ${changedTokens.length} changed tokens out of ${allTokens.length} total`);
          this.wsServer.broadcastUpdate(changedTokens, 'manual');
        } else {
          console.log('No significant token changes detected - no WebSocket broadcast needed');
        }
        
        res.json({ 
          data: allTokens,
          message: 'Tokens refreshed successfully',
          count: allTokens.length,
          changedCount: changedTokens.length,
          websocketBroadcast: changedTokens.length > 0 
            ? `${changedTokens.length} changed tokens sent to WebSocket clients` 
            : 'No significant changes to broadcast'
        });
      } else {
        console.log('Manual refresh completed but no tokens were updated');
        res.json({ 
          data: [],
          message: 'No tokens updated',
          count: 0,
          changedCount: 0,
          websocketBroadcast: 'No updates to broadcast'
        });
      }
    } catch (error) {
      console.error('Refresh tokens error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getTrending(req: Request, res: Response): Promise<void> {
    try {
      // Validate limit parameter
      const limit = req.query.limit as string;
      const parsedLimit = limit ? parseInt(limit) : 10;
      
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        res.status(400).json({ error: 'Invalid limit. Must be between 1 and 50' });
        return;
      }

      const filters: TokenFilters = {
        sortBy: 'price_change',
        limit: parsedLimit
      };

      // Returns merged data from DexScreener and GeckoTerminal APIs, sorted by price change
      const tokens = await this.tokenService.getTokens(filters);
      res.json({ data: tokens });
    } catch (error) {
      console.error('Get trending error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getByVolume(req: Request, res: Response): Promise<void> {
    try {
      // Validate limit and period parameters
      const limit = req.query.limit as string;
      const period = req.query.period as string;
      
      const parsedLimit = limit ? parseInt(limit) : 20;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        res.status(400).json({ error: 'Invalid limit. Must be between 1 and 50' });
        return;
      }

      if (period && !['1h', '24h', '7d'].includes(period)) {
        res.status(400).json({ error: 'Invalid period. Must be 1h, 24h, or 7d' });
        return;
      }

      const filters: TokenFilters = {
        sortBy: 'volume',
        limit: parsedLimit,
        period: period as '1h' | '24h' | '7d'
      };

      // Returns merged data from DexScreener and GeckoTerminal APIs, sorted by volume
      const tokens = await this.tokenService.getTokens(filters);
      res.json({ data: tokens });
    } catch (error) {
      console.error('Get by volume error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
} 