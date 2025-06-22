import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { Token } from '../types';

export class GeckoTerminalClient {
  private client: AxiosInstance;
  private lastRequestTime = 0;
  private requestInterval = 60000 / config.apis.geckoterminal.rateLimit; // Use config rate limit

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.geckoterminal.com/api/v2',
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'meme-coin-aggregator/1.0'
      }
    });
  }

  async getMultipleTokens(addresses: string[]): Promise<Token[]> {
    if (addresses.length === 0) return [];
    
    // Filter and clean addresses
    const validAddresses = this.filterValidSolanaAddresses(addresses);
    if (validAddresses.length === 0) {
      console.log('No valid Solana addresses found for GeckoTerminal');
      return [];
    }
    
    console.log(`Processing ${validAddresses.length} valid addresses for GeckoTerminal`);
    
    return this.withRetry(async () => {
      await this.enforceRateLimit();
      
      // GeckoTerminal supports up to 30 addresses per request
      const chunks = this.chunkAddresses(validAddresses, 30);
      const allTokens: Token[] = [];
      
      for (const chunk of chunks) {
        const addressList = chunk.join(',');
        console.log(`Fetching GeckoTerminal data for ${chunk.length} addresses`);
        
        try {
          const response = await this.client.get(`/networks/solana/tokens/multi/${addressList}`);
          const tokens = this.normalizeTokens(response.data.data || []);
          allTokens.push(...tokens);
          console.log(`Successfully fetched ${tokens.length} tokens from GeckoTerminal`);
        } catch (chunkError) {
          console.error(`GeckoTerminal chunk error:`, chunkError instanceof Error ? chunkError.message : String(chunkError));
          // Continue with other chunks instead of failing completely
          continue;
        }
        
        // Rate limit between chunks
        if (chunks.length > 1) {
          await this.enforceRateLimit();
        }
      }
      
      console.log(`GeckoTerminal enriched ${allTokens.length} tokens total`);
      return allTokens;
    }, 'getMultipleTokens');
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
          console.error(`GeckoTerminal ${operationName} failed after ${maxRetries + 1} attempts:`, lastError.message);
          // For GeckoTerminal, return empty array instead of throwing to prevent service failure
          return [] as T;
        }

        // Check if it's a rate limit error
        if (this.isRateLimitError(error)) {
          const backoffTime = Math.pow(config.rateLimits.backoffMultiplier, attempt) * 2000; // Longer backoff for GeckoTerminal
          console.warn(`GeckoTerminal ${operationName} rate limited, retrying in ${backoffTime}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        // For other errors, wait a shorter time
        if (attempt < maxRetries) {
          const waitTime = 2000 * (attempt + 1); // Longer wait for GeckoTerminal
          console.warn(`GeckoTerminal ${operationName} error, retrying in ${waitTime}ms:`, lastError.message);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    return [] as T; // Return empty array for GeckoTerminal failures
  }

  private isRateLimitError(error: any): boolean {
    if (axios.isAxiosError(error)) {
      return error.response?.status === 429 || error.response?.status === 503;
    }
    return false;
  }

  private filterValidSolanaAddresses(addresses: string[]): string[] {
    // Remove duplicates and filter valid Solana addresses
    const uniqueAddresses = [...new Set(addresses)];
    
    return uniqueAddresses.filter(address => {
      // Basic Solana address validation
      if (!address || typeof address !== 'string') return false;
      
      // Solana addresses are base58 encoded and typically 32-44 characters
      // They don't contain 0x prefix (Ethereum) or contain dots/special chars
      if (address.startsWith('0x')) return false; // Ethereum address
      if (address.includes('.')) return false; // Invalid format
      if (address.includes('ibc/')) return false; // Cosmos IBC address
      if (address.length < 32 || address.length > 44) return false; // Invalid length
      
      // Check for valid base58 characters (basic check)
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
      if (!base58Regex.test(address)) return false;
      
      // Additional checks for obviously invalid addresses
      if (address.includes('0000000000000000000000000000000000000000')) return false; // Null address patterns
      
      return true;
    });
  }

  private chunkAddresses(addresses: string[], chunkSize: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < addresses.length; i += chunkSize) {
      chunks.push(addresses.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private normalizeTokens(tokens: any[]): Token[] {
    return tokens
      .filter(token => {
        // Filter out tokens without basic required data
        const attributes = token.attributes || {};
        return token.id && attributes.name && attributes.symbol;
      })
      .map(token => {
        const attributes = token.attributes || {};
        
        return {
          token_address: token.id || attributes.address || '',
          token_name: attributes.name || '',
          token_ticker: attributes.symbol || '',
          price_sol: parseFloat(attributes.price_usd) || 0,
          market_cap_sol: parseFloat(attributes.market_cap_usd) || 0,
          // GeckoTerminal provides current data, not time-period specific
          volume_1h: 0, // Not available
          volume_24h: parseFloat(attributes.volume_usd?.h24) || 0,
          volume_7d: 0, // Not available in this endpoint
          liquidity_sol: parseFloat(attributes.reserve_in_usd) || 0,
          transaction_count_1h: 0, // Not available
          transaction_count_24h: parseInt(attributes.transactions?.h24?.buys || 0) + parseInt(attributes.transactions?.h24?.sells || 0),
          transaction_count_7d: 0, // Not available
          price_1hr_change: parseFloat(attributes.price_change_percentage?.h1) || 0,
          price_24hr_change: parseFloat(attributes.price_change_percentage?.h24) || 0,
          price_7d_change: 0, // Not available
          protocol: 'GeckoTerminal',
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