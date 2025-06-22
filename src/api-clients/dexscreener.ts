import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { Token, RawTokenData } from '../types';

export class DexScreenerClient {
  private client: AxiosInstance;
  private lastRequestTime = 0;
  private requestInterval = 60000 / config.apis.dexscreener.rateLimit; // ms between requests

  constructor() {
    this.client = axios.create({
      baseURL: config.apis.dexscreener.baseUrl,
      timeout: 10000,
    });
  }

  async searchTokens(query: string = 'meme'): Promise<Token[]> {
    await this.enforceRateLimit();
    
    try {
      const response = await this.client.get(`/search?q=${query}`);
      return this.normalizeTokens(response.data.pairs || []);
    } catch (error) {
      console.error('DexScreener search error:', error);
      return [];
    }
  }

  async getToken(address: string): Promise<Token | null> {
    await this.enforceRateLimit();
    
    try {
      const response = await this.client.get(`/tokens/${address}`);
      const pairs = response.data.pairs || [];
      const normalized = this.normalizeTokens(pairs);
      return normalized[0] || null;
    } catch (error) {
      console.error('DexScreener token error:', error);
      return null;
    }
  }

  private normalizeTokens(pairs: any[]): Token[] {
    return pairs.map(pair => ({
      token_address: pair.baseToken?.address || '',
      token_name: pair.baseToken?.name || '',
      token_ticker: pair.baseToken?.symbol || '',
      price_sol: parseFloat(pair.priceNative) || 0,
      market_cap_sol: parseFloat(pair.marketCap) || 0,
      volume_1h: parseFloat(pair.volume?.h1) || 0,
      volume_24h: parseFloat(pair.volume?.h24) || 0,
      volume_7d: parseFloat(pair.volume?.d7) || 0,
      liquidity_sol: parseFloat(pair.liquidity?.usd) || 0,
      transaction_count_1h: (parseInt(pair.txns?.h1?.buys || 0) + parseInt(pair.txns?.h1?.sells || 0)) || 0,
      transaction_count_24h: (parseInt(pair.txns?.h24?.buys || 0) + parseInt(pair.txns?.h24?.sells || 0)) || 0,
      transaction_count_7d: (parseInt(pair.txns?.d7?.buys || 0) + parseInt(pair.txns?.d7?.sells || 0)) || 0,
      price_1hr_change: parseFloat(pair.priceChange?.h1) || 0,
      price_24hr_change: parseFloat(pair.priceChange?.h24) || 0,
      price_7d_change: parseFloat(pair.priceChange?.d7) || 0,
      protocol: pair.dexId || 'DexScreener',
      timestamp: new Date().toISOString()
    }));
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestInterval) {
      const waitTime = this.requestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }
} 