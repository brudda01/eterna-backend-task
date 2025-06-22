import Redis from 'ioredis';
import { config } from '../config';
import { Token } from '../types';

export class CacheManager {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(config.redis.url);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const ttlSeconds = ttl || config.redis.ttl;
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async getTokens(filters?: any): Promise<Token[]> {
    const key = this.buildTokenKey(filters);
    return await this.get<Token[]>(key) || [];
  }

  async setTokens(tokens: Token[], filters?: any): Promise<void> {
    const key = this.buildTokenKey(filters);
    await this.set(key, tokens);
  }

  async getToken(address: string): Promise<Token | null> {
    return await this.get<Token>(`token:${address}`);
  }

  async setToken(token: Token): Promise<void> {
    await this.set(`token:${token.token_address}`, token);
  }

  private buildTokenKey(filters?: any): string {
    if (!filters) return 'tokens:all';
    const { period, sortBy, limit } = filters;
    return `tokens:${period || 'all'}:${sortBy || 'default'}:${limit || 'all'}`;
  }

  async flushAll(): Promise<void> {
    await this.redis.flushall();
  }

  async disconnect(): Promise<void> {
    await this.redis.disconnect();
  }
} 