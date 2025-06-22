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
    try {
      // Try to get filtered tokens from cache first
      const cachedTokens = await this.cache.getTokens(filters);
      if (cachedTokens && cachedTokens.length > 0) {
        console.log(`Returning ${cachedTokens.length} tokens from cache with filters:`, filters);
        return cachedTokens;
      }

      // If no cached filtered data, try to get all tokens from cache and filter them
      const allCachedTokens = await this.cache.getTokens(); // tokens:all
      if (allCachedTokens && allCachedTokens.length > 0) {
        console.log(`Filtering ${allCachedTokens.length} cached tokens with filters:`, filters);
        const filteredTokens = this.applyFilters(allCachedTokens, filters);
        
        // Cache this filter combination for future requests
        if (filters) {
          await this.cache.setTokens(filteredTokens, filters);
        }
        
        return filteredTokens;
      }

      // If no cache at all, fetch fresh data (this triggers comprehensive caching)
      console.log('No cached data found, fetching fresh tokens via refreshTokens...');
      const { allTokens } = await this.refreshTokens();
      return this.applyFilters(allTokens, filters);
    } catch (error) {
      console.error('Error in getTokens:', error instanceof Error ? error.message : String(error));
      // Fallback: try to return any cached data without filters
      const fallbackTokens = await this.cache.getTokens();
      return fallbackTokens || [];
    }
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

  async refreshTokens(): Promise<{ allTokens: Token[]; changedTokens: Token[] }> {
    // 1. Get the current list of all tokens from cache to compare against
    const oldTokens = await this.cache.getTokens();

    // 2. Fetch fresh data from APIs
    const newTokens = await this.fetchAndEnrichTokens();

    if (newTokens.length === 0) {
      console.warn('Refresh resulted in 0 tokens. Not updating cache or detecting changes.');
      return { allTokens: [], changedTokens: [] };
    }

    // 3. Detect changes by comparing new data against the old cached data
    const changedTokens = await this.detectChangedTokens(newTokens, oldTokens);

    // 4. NOW, cache the new data comprehensively
    await this.cacheTokensComprehensively(newTokens);

    return { allTokens: newTokens, changedTokens };
  }

  private async cacheTokensComprehensively(tokens: Token[]): Promise<void> {
    try {
      // 1. Cache the complete unfiltered token list
      await this.cache.setTokens(tokens); // tokens:all
      
      // 2. Cache individual tokens for getToken() and change detection
      const individualCachePromises = tokens.map(token => 
        this.cache.setToken(token)
      );
      await Promise.all(individualCachePromises);
      
      // 3. Pre-cache common filter combinations to speed up API requests
      const commonFilterCombinations = [
        // Default API calls
        { period: '24h' as const, sortBy: 'volume' as const, limit: 20 },
        { period: '24h' as const, sortBy: 'volume' as const, limit: 50 },
        { period: '1h' as const, sortBy: 'volume' as const, limit: 20 },
        { period: '7d' as const, sortBy: 'volume' as const, limit: 20 },
        { period: '24h' as const, sortBy: 'price_change' as const, limit: 10 },
        { period: '24h' as const, sortBy: 'market_cap' as const, limit: 20 },
        // Trending endpoint calls
        { sortBy: 'price_change' as const, limit: 10 },
        { sortBy: 'price_change' as const, limit: 50 },
        // Volume endpoint calls  
        { sortBy: 'volume' as const, limit: 20 },
        { sortBy: 'volume' as const, limit: 50 }
      ];
      
      // Pre-filter and cache common combinations
      const cachePromises = commonFilterCombinations.map(async (filters) => {
        const filteredTokens = this.applyFilters(tokens, filters);
        await this.cache.setTokens(filteredTokens, filters);
      });
      
      await Promise.all(cachePromises);
      
      console.log(`Cached ${tokens.length} tokens with ${commonFilterCombinations.length} filter combinations + individual token cache`);
    } catch (error) {
      console.error('Error caching tokens comprehensively:', error instanceof Error ? error.message : String(error));
      // Fallback to basic caching
      await this.cache.setTokens(tokens);
    }
  }

  private async fetchAndEnrichTokens(): Promise<Token[]> {
    try {
      console.log('Fetching meme tokens from DexScreener...');
      const dexTokens = await this.dexScreener.searchTokens('meme');
      
      const allDexTokens = [...dexTokens];
      
      if (allDexTokens.length === 0) {
        console.log('No tokens found from DexScreener');
        return [];
      }

      const validAddresses = allDexTokens
        .map(token => token.token_address)
        .filter(address => this.isValidSolanaAddress(address));
      
      console.log(`Found ${validAddresses.length} valid Solana addresses out of ${allDexTokens.length} total tokens`);
      
      if (validAddresses.length === 0) {
        console.log('No valid Solana addresses found, returning DexScreener data only');
        return this.filterForDashboard(allDexTokens);
      }

      console.log('Enriching with GeckoTerminal data...');
      const geckoTokens = await this.geckoTerminal.getMultipleTokens(validAddresses);
      
      const mergedTokens = this.mergeTokenData(allDexTokens, geckoTokens);
      console.log(`Merged data: ${mergedTokens.length} tokens`);
      
      const filteredTokens = this.filterForDashboard(mergedTokens);
      console.log(`Final filtered tokens: ${filteredTokens.length}`);
      
      return filteredTokens;
    } catch (error) {
      console.error('Error in fetchAndEnrichTokens:', error instanceof Error ? error.message : String(error));
      throw error;
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
    const mergedVolume24h = dexToken.volume_24h + geckoToken.volume_24h;
    const mergedTransactionCount24h = dexToken.transaction_count_24h + geckoToken.transaction_count_24h;
    
    return {
      ...dexToken, // Start with DexScreener data
      // Use GeckoTerminal price if it seems more accurate (non-zero)
      price_sol: geckoToken.price_sol > 0 ? geckoToken.price_sol : dexToken.price_sol,
      // Use higher market cap value
      market_cap_sol: Math.max(dexToken.market_cap_sol, geckoToken.market_cap_sol),
      // Sum volumes for better accuracy
      volume_24h: mergedVolume24h,
      volume_sol: mergedVolume24h, // Update compatibility alias
      // Sum transaction counts
      transaction_count_24h: mergedTransactionCount24h,
      transaction_count: mergedTransactionCount24h, // Update compatibility alias
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

  async detectChangedTokens(newTokens: Token[], oldTokens: Token[] | null): Promise<Token[]> {
    if (newTokens.length === 0) return [];

    const oldTokensMap = new Map<string, Token>();
    if (oldTokens) {
      for (const token of oldTokens) {
        oldTokensMap.set(token.token_address, token);
      }
      console.log(`Comparing against ${oldTokens.length} cached tokens`);
    } else {
      console.log('No cached tokens found - treating all tokens as new/changed');
    }

    try {
      const changedTokens: Token[] = [];
      let debugCount = 0;
      
      // Check each token against cached version
      for (const newToken of newTokens) {
        const cachedToken = oldTokensMap.get(newToken.token_address);
        
        if (!cachedToken) {
          // New token - consider it changed
          changedTokens.push(newToken);
          if (debugCount < 5) {
            console.log(`New token detected: ${newToken.token_ticker} (${newToken.token_address})`);
            debugCount++;
          }
          continue;
        }

        // More sensitive change detection for testing
        const priceChange = this.hasPriceChanged(newToken, cachedToken);
        const volumeChange = this.hasVolumeChanged(newToken, cachedToken);
        const marketCapChange = this.hasMarketCapChanged(newToken, cachedToken);
        const transactionChange = this.hasTransactionCountChanged(newToken, cachedToken);
        
        const hasChanged = priceChange || volumeChange || marketCapChange || transactionChange;

        if (hasChanged) {
          changedTokens.push(newToken);
          if (debugCount < 5) {
            console.log(`Change detected for ${newToken.token_ticker}:`);
            console.log(`  Price: ${cachedToken.price_sol} -> ${newToken.price_sol} (changed: ${priceChange})`);
            console.log(`  Volume 24h: ${cachedToken.volume_24h} -> ${newToken.volume_24h} (changed: ${volumeChange})`);
            console.log(`  Market Cap: ${cachedToken.market_cap_sol} -> ${newToken.market_cap_sol} (changed: ${marketCapChange})`);
            console.log(`  Transactions: ${cachedToken.transaction_count_24h} -> ${newToken.transaction_count_24h} (changed: ${transactionChange})`);
            debugCount++;
          }
        }
      }

      console.log(`Detected ${changedTokens.length} changed tokens out of ${newTokens.length} total tokens`);
      
      // If no changes detected, show some sample comparisons for debugging
      if (changedTokens.length === 0 && oldTokens && oldTokens.length > 0) {
        console.log('No changes detected. Sample comparisons:');
        for (let i = 0; i < Math.min(3, newTokens.length); i++) {
          const newToken = newTokens[i];
          const cachedToken = oldTokensMap.get(newToken.token_address);
          if (cachedToken) {
            console.log(`  ${newToken.token_ticker}: Price ${cachedToken.price_sol} -> ${newToken.price_sol}, Volume ${cachedToken.volume_24h} -> ${newToken.volume_24h}`);
          }
        }
      }
      
      return changedTokens;
    } catch (error) {
      console.error('Error detecting changed tokens:', error instanceof Error ? error.message : String(error));
      // If we can't detect changes, return all tokens to be safe
      return newTokens;
    }
  }

  private hasPriceChanged(newToken: Token, cachedToken: Token): boolean {
    // Very sensitive price changes - detect even tiny movements
    const priceThreshold = Math.max(cachedToken.price_sol * 0.001, 0.00000001); // 0.1% or minimum threshold (very sensitive)
    const priceDiff = Math.abs(newToken.price_sol - cachedToken.price_sol);
    
    // Price change percentages - very sensitive
    const priceChange1h = Math.abs(newToken.price_1hr_change - cachedToken.price_1hr_change);
    const priceChange24h = Math.abs((newToken.price_24hr_change || 0) - (cachedToken.price_24hr_change || 0));
    
    return priceDiff > priceThreshold || priceChange1h > 0.1 || priceChange24h > 0.1;
  }

  private hasVolumeChanged(newToken: Token, cachedToken: Token): boolean {
    // Very sensitive volume changes - detect small movements
    const volume24hThreshold = Math.max(cachedToken.volume_24h * 0.001, 1); // 0.1% or $1 (very sensitive)
    const volume24hDiff = Math.abs(newToken.volume_24h - cachedToken.volume_24h);
    
    const volume1hThreshold = Math.max((cachedToken.volume_1h || 0) * 0.001, 0.1); // 0.1% or $0.1 (very sensitive)
    const volume1hDiff = Math.abs((newToken.volume_1h || 0) - (cachedToken.volume_1h || 0));
    
    return volume24hDiff > volume24hThreshold || volume1hDiff > volume1hThreshold;
  }

  private hasMarketCapChanged(newToken: Token, cachedToken: Token): boolean {
    // Very sensitive market cap changes - detect tiny movements
    const marketCapThreshold = Math.max(cachedToken.market_cap_sol * 0.001, 1); // 0.1% or $1 (very sensitive)
    const marketCapDiff = Math.abs(newToken.market_cap_sol - cachedToken.market_cap_sol);
    
    return marketCapDiff > marketCapThreshold;
  }

  private hasTransactionCountChanged(newToken: Token, cachedToken: Token): boolean {
    // Very sensitive transaction count changes - detect any change
    const txn24hThreshold = Math.max(cachedToken.transaction_count_24h * 0.001, 0.1); // 0.1% or any change (very sensitive)
    const txn24hDiff = Math.abs(newToken.transaction_count_24h - cachedToken.transaction_count_24h);
    
    const txn1hThreshold = Math.max((cachedToken.transaction_count_1h || 0) * 0.001, 0.1); // 0.1% or any change (very sensitive)
    const txn1hDiff = Math.abs((newToken.transaction_count_1h || 0) - (cachedToken.transaction_count_1h || 0));
    
    return txn24hDiff > txn24hThreshold || txn1hDiff > txn1hThreshold;
  }

  private isValidSolanaAddress(address: string): boolean {
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
  }
} 