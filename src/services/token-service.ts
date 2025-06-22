import { DexScreenerClient } from '../api-clients/dexscreener';
import { GeckoTerminalClient } from '../api-clients/geckoterminal';
import { CacheManager } from '../cache/redis';
import { Token, TokenFilters } from '../types';

export class TokenService {
  private dexScreener: DexScreenerClient;
  private geckoTerminal: GeckoTerminalClient;
  private cache: CacheManager;

  constructor() {
    this.dexScreener = new DexScreenerClient();
    this.geckoTerminal = new GeckoTerminalClient();
    this.cache = new CacheManager();
  }

  async getTokens(filters?: TokenFilters): Promise<Token[]> {
    // Try cache first
    const cached = await this.cache.getTokens(filters);
    if (cached.length > 0) {
      return this.applyFilters(cached, filters);
    }

    // Fetch and enrich data
    const tokens = await this.fetchAndEnrichTokens();
    
    // Cache the results
    await this.cache.setTokens(tokens, filters);
    
    return this.applyFilters(tokens, filters);
  }

  async getToken(address: string): Promise<Token | null> {
    // Check cache first
    const cached = await this.cache.getToken(address);
    if (cached) return cached;

    // Try DexScreener first
    const dexToken = await this.dexScreener.getToken(address);
    if (dexToken) {
      // Try to enrich with GeckoTerminal data
      const geckoTokens = await this.geckoTerminal.getMultipleTokens([address]);
      const geckoToken = geckoTokens[0];
      
      if (geckoToken) {
        const merged = this.mergeTokenPair(dexToken, geckoToken);
        await this.cache.setToken(merged);
        return merged;
      }
      
      await this.cache.setToken(dexToken);
      return dexToken;
    }

    return null;
  }

  async refreshTokens(): Promise<Token[]> {
    // Fetch fresh data from both sources
    const tokens = await this.fetchAndEnrichTokens();
    await this.cache.setTokens(tokens);
    return tokens;
  }

  private async fetchAndEnrichTokens(): Promise<Token[]> {
    try {
      // Step 1: Get meme tokens from DexScreener
      const dexTokens = await this.dexScreener.searchTokens('meme');
      console.log(`Fetched ${dexTokens.length} tokens from DexScreener`);

      if (dexTokens.length === 0) {
        return [];
      }

      // Step 2: Extract addresses for GeckoTerminal
      const addresses = dexTokens
        .map(token => token.token_address)
        .filter(address => address && address.length > 0);
      
      console.log(`Extracted ${addresses.length} addresses for GeckoTerminal enrichment`);

      // Step 3: Enrich with GeckoTerminal data
      const geckoTokens = await this.geckoTerminal.getMultipleTokens(addresses);
      
      // Step 4: Merge the data
      const mergedTokens = this.mergeTokenData(dexTokens, geckoTokens);
      
      // Step 5: Apply dashboard filtering
      const dashboardTokens = this.filterForDashboard(mergedTokens);
      
      console.log(`Merged and filtered to ${dashboardTokens.length} dashboard-ready tokens`);
      return dashboardTokens;
    } catch (error) {
      console.error('Error fetching and enriching tokens:', error);
      return [];
    }
  }

  private mergeTokenData(dexTokens: Token[], geckoTokens: Token[]): Token[] {
    // Create a map of GeckoTerminal tokens by address for quick lookup
    const geckoMap = new Map<string, Token>();
    geckoTokens.forEach(token => {
      geckoMap.set(token.token_address, token);
    });

    // Merge DexScreener tokens with GeckoTerminal data
    return dexTokens.map(dexToken => {
      const geckoToken = geckoMap.get(dexToken.token_address);
      
      if (geckoToken) {
        return this.mergeTokenPair(dexToken, geckoToken);
      }
      
      // Return DexScreener token if no GeckoTerminal data
      return dexToken;
    });
  }

  private mergeTokenPair(dexToken: Token, geckoToken: Token): Token {
    // Merge logic: DexScreener provides better trading data, GeckoTerminal provides additional validation
    return {
      ...dexToken, // Start with DexScreener data
      // Use GeckoTerminal price if it seems more accurate (non-zero)
      price_sol: geckoToken.price_sol > 0 ? geckoToken.price_sol : dexToken.price_sol,
      // Use higher market cap value
      market_cap_sol: Math.max(dexToken.market_cap_sol, geckoToken.market_cap_sol),
      // Sum volumes for better accuracy
      volume_24h: dexToken.volume_24h + geckoToken.volume_24h,
      // Use higher liquidity value  
      liquidity_sol: Math.max(dexToken.liquidity_sol, geckoToken.liquidity_sol),
      // Use latest timestamp
      timestamp: geckoToken.timestamp > dexToken.timestamp ? geckoToken.timestamp : dexToken.timestamp,
      // Indicate this is merged data
      protocol: `${dexToken.protocol}+GeckoTerminal`
    };
  }

  private filterForDashboard(tokens: Token[]): Token[] {
    return tokens.filter(token => {
      // Must have basic info
      if (!token.token_address || !token.token_name || !token.token_ticker) {
        return false;
      }

      // Skip obvious test/junk tokens
      if (token.token_ticker === 'Unknown' || 
          token.token_name.length < 2 ||
          token.token_ticker.length < 2) {
        return false;
      }

      // For dashboard, we want tokens with some trading activity (24h is standard)
      return token.volume_24h > 0 && token.liquidity_sol > 0;
      
    }).sort((a, b) => {
      // Sort by 24h volume descending for better dashboard display
      return b.volume_24h - a.volume_24h;
    });
  }

  private applyPeriodFilter(tokens: Token[], period: '1h' | '24h' | '7d'): Token[] {
    return tokens.filter(token => {
      switch (period) {
        case '1h':
          // For 1h filter, require some 1h activity
          return (token.volume_1h || 0) > 0 || (token.transaction_count_1h || 0) > 0;
        case '24h':
          // For 24h filter, require some 24h activity (default)
          return token.volume_24h > 0 || token.transaction_count_24h > 0;
        case '7d':
          // For 7d filter, require some 7d activity
          return (token.volume_7d || 0) > 0 || (token.transaction_count_7d || 0) > 0;
        default:
          return true;
      }
    });
  }

  private applySorting(tokens: Token[], sortBy: string, period?: '1h' | '24h' | '7d'): Token[] {
    return tokens.sort((a, b) => {
      switch (sortBy) {
        case 'volume':
          return this.getVolumeForPeriod(b, period) - this.getVolumeForPeriod(a, period);
        case 'price_change':
          return this.getPriceChangeForPeriod(b, period) - this.getPriceChangeForPeriod(a, period);
        case 'market_cap':
          return b.market_cap_sol - a.market_cap_sol;
        default:
          return 0;
      }
    });
  }

  private getVolumeForPeriod(token: Token, period?: '1h' | '24h' | '7d'): number {
    switch (period) {
      case '1h':
        return token.volume_1h || 0;
      case '7d':
        return token.volume_7d || 0;
      case '24h':
      default:
        return token.volume_24h;
    }
  }

  private getPriceChangeForPeriod(token: Token, period?: '1h' | '24h' | '7d'): number {
    switch (period) {
      case '1h':
        return token.price_1hr_change;
      case '24h':
        return token.price_24hr_change || 0;
      case '7d':
        return token.price_7d_change || 0;
      default:
        return token.price_1hr_change;
    }
  }

  private applyFilters(tokens: Token[], filters?: TokenFilters): Token[] {
    if (!filters) return tokens;

    let filtered = [...tokens];

    // Apply period-based filtering first
    if (filters.period) {
      filtered = this.applyPeriodFilter(filtered, filters.period);
    }

    // Apply sorting
    if (filters.sortBy) {
      filtered = this.applySorting(filtered, filters.sortBy, filters.period);
    }

    // Apply cursor-based pagination
    if (filters.cursor) {
      const cursorIndex = filtered.findIndex(token => token.token_address === filters.cursor);
      if (cursorIndex !== -1) {
        filtered = filtered.slice(cursorIndex + 1);
      }
    }

    // Apply limit
    if (filters.limit && filters.limit > 0) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  async detectChangedTokens(newTokens: Token[]): Promise<Token[]> {
    if (newTokens.length === 0) return [];

    try {
      const changedTokens: Token[] = [];
      
      // Check each token against cached version
      for (const newToken of newTokens) {
        const cacheKey = `token:${newToken.token_address}`;
        const cachedTokenData = await this.cache.get<string>(cacheKey);
        
        if (!cachedTokenData) {
          // New token - consider it changed
          changedTokens.push(newToken);
          continue;
        }

        const cachedToken: Token = JSON.parse(cachedTokenData);
        
        // Compare key fields that indicate meaningful changes
        const hasChanged = 
          // Price changes (using price_sol)
          Math.abs(newToken.price_sol - cachedToken.price_sol) > (cachedToken.price_sol * 0.001) || // 0.1% price change
          Math.abs(newToken.price_1hr_change - cachedToken.price_1hr_change) > 0.5 || // 0.5% change in 1h percentage
          Math.abs((newToken.price_24hr_change || 0) - (cachedToken.price_24hr_change || 0)) > 0.5 || // 0.5% change in 24h percentage
          Math.abs((newToken.price_7d_change || 0) - (cachedToken.price_7d_change || 0)) > 1.0 || // 1% change in 7d percentage
          
          // Volume changes (significant threshold)
          Math.abs((newToken.volume_1h || 0) - (cachedToken.volume_1h || 0)) > Math.max((cachedToken.volume_1h || 0) * 0.1, 100) || // 10% or $100
          Math.abs(newToken.volume_24h - cachedToken.volume_24h) > Math.max(cachedToken.volume_24h * 0.05, 1000) || // 5% or $1000
          Math.abs((newToken.volume_7d || 0) - (cachedToken.volume_7d || 0)) > Math.max((cachedToken.volume_7d || 0) * 0.05, 5000) || // 5% or $5000
          
          // Market cap changes
          Math.abs(newToken.market_cap_sol - cachedToken.market_cap_sol) > Math.max(cachedToken.market_cap_sol * 0.02, 10000) || // 2% or $10k
          
          // Transaction count changes
          Math.abs((newToken.transaction_count_1h || 0) - (cachedToken.transaction_count_1h || 0)) > Math.max((cachedToken.transaction_count_1h || 0) * 0.1, 5) || // 10% or 5 txns
          Math.abs(newToken.transaction_count_24h - cachedToken.transaction_count_24h) > Math.max(cachedToken.transaction_count_24h * 0.05, 10); // 5% or 10 txns

        if (hasChanged) {
          changedTokens.push(newToken);
        }
      }

      console.log(`Detected ${changedTokens.length} changed tokens out of ${newTokens.length} total tokens`);
      return changedTokens;
    } catch (error) {
      console.error('Error detecting changed tokens:', error instanceof Error ? error.message : String(error));
      // If we can't detect changes, return all tokens to be safe
      return newTokens;
    }
  }
} 