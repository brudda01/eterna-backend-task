import { Request, Response } from 'express';
import { TokenService } from '../services/token-service';
import { TokenFilters } from '../types';

export class TokenController {
  private tokenService: TokenService;

  constructor() {
    this.tokenService = new TokenService();
  }

  async getTokens(req: Request, res: Response): Promise<void> {
    try {
      const filters: TokenFilters = {
        period: req.query.period as '1h' | '24h' | '7d',
        sortBy: req.query.sortBy as 'volume' | 'price_change' | 'market_cap',
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
        cursor: req.query.cursor as string
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
      // Tries Jupiter first, then DexScreener, returns merged data
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
      // Refreshes data from both APIs and merges them
      const tokens = await this.tokenService.refreshTokens();
      res.json({ 
        data: tokens,
        message: 'Tokens refreshed successfully'
      });
    } catch (error) {
      console.error('Refresh tokens error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getTrending(req: Request, res: Response): Promise<void> {
    try {
      const filters: TokenFilters = {
        sortBy: 'price_change',
        limit: 10
      };

      // Returns merged data from both DexScreener and Jupiter APIs, sorted by price change
      const tokens = await this.tokenService.getTokens(filters);
      res.json({ data: tokens });
    } catch (error) {
      console.error('Get trending error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getByVolume(req: Request, res: Response): Promise<void> {
    try {
      const filters: TokenFilters = {
        sortBy: 'volume',
        limit: 20
      };

      // Returns merged data from both DexScreener and Jupiter APIs, sorted by volume
      const tokens = await this.tokenService.getTokens(filters);
      res.json({ data: tokens });
    } catch (error) {
      console.error('Get by volume error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
} 