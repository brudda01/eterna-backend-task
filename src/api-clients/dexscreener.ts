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
    // Use multiple search queries to get more tokens
    const searchQueries = [
      'meme',
      'pepe', 
      'doge',
      'shib',
      'bonk',
      'floki',
      'wojak',
      'moon',
      'hodl'
    ];
    
    const allTokens: Token[] = [];
    const seenAddresses = new Set<string>();
    
    for (const searchQuery of searchQueries) {
      try {
        // Handle each query with individual retry logic
        const tokens = await this.withRetry(async () => {
          await this.enforceRateLimit();
          const response = await this.client.get(`/search?q=${encodeURIComponent(searchQuery)}`);
          return this.normalizeTokens(response.data.pairs || []);
        }, `searchTokens-${searchQuery}`);
        
        // Add unique tokens only
        for (const token of tokens) {
          if (!seenAddresses.has(token.token_address)) {
            seenAddresses.add(token.token_address);
            allTokens.push(token);
          }
        }
        
        console.log(`DexScreener returned ${tokens.length} tokens for query: ${searchQuery}`);
      } catch (error) {
        console.warn(`Failed to fetch tokens for query "${searchQuery}" after retries:`, error instanceof Error ? error.message : String(error));
        // Continue with other queries even if one fails completely
      }
    }
    
    console.log(`DexScreener total: ${allTokens.length} unique tokens from ${searchQueries.length} queries`);
    return allTokens;
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

  async getTrendingTokens(): Promise<Token[]> {
    // DexScreener doesn't have a trending endpoint, so gonna search for popular meme tokens
    const popularQueries = ['bonk', 'pepe', 'shib', 'doge', 'floki'];
    const allTokens: Token[] = [];
    const seenAddresses = new Set<string>();
    
    for (const query of popularQueries) {
      try {
        const tokens = await this.withRetry(async () => {
          await this.enforceRateLimit();
          const response = await this.client.get(`/search?q=${encodeURIComponent(query)}`);
          return this.normalizeTokens(response.data.pairs || []);
        }, `getTrendingTokens-${query}`);
        
        // Take only top 5 tokens per query to simulate "trending"
        const topTokens = tokens
          .sort((a, b) => b.volume_24h - a.volume_24h)
          .slice(0, 5);
        
        for (const token of topTokens) {
          if (!seenAddresses.has(token.token_address)) {
            seenAddresses.add(token.token_address);
            allTokens.push(token);
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch trending tokens for query "${query}":`, error instanceof Error ? error.message : String(error));
      }
    }
    
    console.log(`DexScreener trending simulation returned ${allTokens.length} tokens`);
    return allTokens;
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