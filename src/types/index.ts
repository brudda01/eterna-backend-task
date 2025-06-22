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
  liquidity_sol: number;
  transaction_count_1h?: number;
  transaction_count_24h: number;
  transaction_count_7d?: number;
  price_1hr_change: number;
  price_24hr_change?: number;
  price_7d_change?: number;
  protocol: string;
  timestamp: string;
  // Optional Jupiter-specific fields
  tags?: string[];
  created_at?: string;
  logo_uri?: string;
  freeze_authority?: string | null;
  mint_authority?: string | null;
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
  type: 'PRICE_UPDATE' | 'VOLUME_UPDATE' | 'NEW_TOKEN';
  data: Token | Token[];
  timestamp: string;
}

export interface RawTokenData {
  [key: string]: any;
}

export interface DataSource {
  name: string;
  baseUrl: string;
  rateLimit: number;
  endpoints: {
    search: string;
    token: string;
  };
} 