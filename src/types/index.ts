export interface Token {
  token_address: string;
  token_name: string;
  token_ticker: string;
  price_sol: number;
  market_cap_sol: number;
  // Time period specific data
  volume_1h?: number;
  volume_24h: number;
  volume_7d?: number;
  volume_sol: number; // Alias for volume_24h (for API compatibility)
  liquidity_sol: number;
  transaction_count_1h?: number;
  transaction_count_24h: number;
  transaction_count_7d?: number;
  transaction_count: number; // Alias for transaction_count_24h (for API compatibility)
  price_1hr_change: number;
  price_24hr_change?: number;
  price_7d_change?: number;
  protocol: string;
  timestamp: string;
}

export interface TokenFilters {
  period?: '1h' | '24h' | '7d';
  sortBy?: 'volume' | 'price_change' | 'market_cap';
  limit?: number;
  cursor?: string;
}

export interface ApiResponse<T> {
  data: T;
  pagination?: {
    hasNext: boolean;
    nextCursor?: string;
  };
}

export interface WebSocketMessage {
  type: 'UPDATE';
  data: Token | Token[] | any; // Allow any data structure for system messages
  timestamp: string;
} 