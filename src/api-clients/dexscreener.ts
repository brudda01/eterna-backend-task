import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import { Token } from '../types';

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
    return this.withRetry(async () => {
      await this.enforceRateLimit();
      
      const response = await this.client.get(`/search?q=${encodeURIComponent(query)}`);
      const tokens = this.normalizeTokens(response.data.pairs || []);
      console.log(`DexScreener returned ${tokens.length} tokens for query: ${query}`);
      return tokens;
    }, 'searchTokens');
  }

  async getToken(address: string): Promise<Token | null> {
    return this.withRetry(async () => {
      await this.enforceRateLimit();
      
      const response = await this.client.get(`/tokens/${address}`);
      const pairs = response.data.pairs || [];
      const normalized = this.normalizeTokens(pairs);
      return normalized[0] || null;
    }, 'getToken');
  }

  private async withRetry<T>(
    operation: () => Promise<T>, 
    operationName: string,
    maxRetries: number = config.rateLimits.maxRetries
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          console.error(`DexScreener ${operationName} failed after ${maxRetries + 1} attempts:`, lastError.message);
          throw lastError;
        }

        // Check if it's a rate limit error
        if (this.isRateLimitError(error)) {
          const backoffTime = Math.pow(config.rateLimits.backoffMultiplier, attempt) * 1000;
          console.warn(`DexScreener ${operationName} rate limited, retrying in ${backoffTime}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        // For other errors, wait a shorter time
        if (attempt < maxRetries) {
          const waitTime = 1000 * (attempt + 1);
          console.warn(`DexScreener ${operationName} error, retrying in ${waitTime}ms:`, lastError.message);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    throw lastError!;
  }

  private isRateLimitError(error: any): boolean {
    if (axios.isAxiosError(error)) {
      return error.response?.status === 429 || error.response?.status === 503;
    }
    return false;
  }

  private normalizeTokens(pairs: any[]): Token[] {
    return pairs
      .filter(pair => {
        // Filter out invalid pairs
        return pair.baseToken?.address && 
               pair.baseToken?.name && 
               pair.baseToken?.symbol &&
               pair.priceNative !== undefined;
      })
      .map(pair => {
        const volume24h = parseFloat(pair.volume?.h24) || 0;
        const transactionCount24h = (parseInt(pair.txns?.h24?.buys || 0) + parseInt(pair.txns?.h24?.sells || 0)) || 0;
        
        return {
          token_address: pair.baseToken.address,
          token_name: pair.baseToken.name,
          token_ticker: pair.baseToken.symbol,
          price_sol: parseFloat(pair.priceNative) || 0,
          market_cap_sol: parseFloat(pair.marketCap) || 0,
          volume_1h: parseFloat(pair.volume?.h1) || 0,
          volume_24h: volume24h,
          volume_7d: parseFloat(pair.volume?.d7) || 0,
          volume_sol: volume24h, // Compatibility alias
          liquidity_sol: parseFloat(pair.liquidity?.usd) || 0,
          transaction_count_1h: (parseInt(pair.txns?.h1?.buys || 0) + parseInt(pair.txns?.h1?.sells || 0)) || 0,
          transaction_count_24h: transactionCount24h,
          transaction_count_7d: (parseInt(pair.txns?.d7?.buys || 0) + parseInt(pair.txns?.d7?.sells || 0)) || 0,
          transaction_count: transactionCount24h, // Compatibility alias
          price_1hr_change: parseFloat(pair.priceChange?.h1) || 0,
          price_24hr_change: parseFloat(pair.priceChange?.h24) || 0,
          price_7d_change: parseFloat(pair.priceChange?.d7) || 0,
          protocol: pair.dexId || 'DexScreener',
          timestamp: new Date().toISOString()
        };
      });
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