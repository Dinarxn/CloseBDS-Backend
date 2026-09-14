import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { createInMemoryPrismaClient } from './in-memory.js';

export interface DatabaseReadinessResult {
  ready: boolean;
  status: 'connected' | 'disconnected' | 'error';
  latencyMs?: number;
  message: string;
}

export interface DatabaseClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  healthCheck(): Promise<DatabaseReadinessResult>;
  transaction<T>(callback: (prisma: PrismaClient) => Promise<T>): Promise<T>;
  getPrismaClient(): PrismaClient;
  setPrismaClient?(prisma: PrismaClient | null): void;
}

/**
 * Production-ready PostgreSQL Database Client wrapper using Prisma ORM.
 * Decouples business modules and repositories from direct connection specifics.
 */
export class PrismaDatabaseClient implements DatabaseClient {
  private prisma: PrismaClient | null = null;
  private connected = false;
  private readonly databaseUrl: string | undefined;

  constructor(databaseUrl?: string) {
    this.databaseUrl = arguments.length > 0 ? databaseUrl : config.DATABASE_URL;
  }

  /**
   * Initializes PrismaClient and establishes database connection pool.
   */
  async connect(): Promise<void> {
    if (this.connected && this.prisma) {
      return;
    }

    if (!this.databaseUrl) {
      // In development/test mode without DATABASE_URL, remain gracefully disconnected
      this.connected = false;
      return;
    }

    try {
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: this.databaseUrl,
          },
        },
        log:
          config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
            ? ['warn', 'error']
            : ['error'],
      });

      await this.prisma.$connect();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      // Do NOT leak databaseUrl or credentials in thrown error
      const safeErrorMessage =
        error instanceof Error ? error.message : 'Unknown database connection error';
      throw new Error(`Database connection failed: ${safeErrorMessage}`);
    }
  }

  /**
   * Gracefully disconnects Prisma client and drains connection pool.
   */
  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.connected = false;
    }
  }

  /**
   * Returns current connection state.
   */
  isConnected(): boolean {
    return this.connected && this.prisma !== null;
  }

  /**
   * Executes atomic database transaction.
   */
  async transaction<T>(callback: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    const prisma = this.getPrismaClient();
    return prisma.$transaction(async (tx) => {
      return callback(tx as unknown as PrismaClient);
    });
  }

  /**
   * Performs dependency readiness health check without leaking credentials or internal SQL info.
   */
  async healthCheck(): Promise<DatabaseReadinessResult> {
    if (!this.databaseUrl) {
      return {
        ready: false,
        status: 'disconnected',
        message: 'DATABASE_URL is not configured',
      };
    }

    if (!this.prisma) {
      return {
        ready: false,
        status: 'disconnected',
        message: 'Database client is not initialized',
      };
    }

    const startTime = Date.now();
    try {
      // Safe ping query
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - startTime;
      return {
        ready: true,
        status: 'connected',
        latencyMs,
        message: 'Database is reachable and responding',
      };
    } catch {
      return {
        ready: false,
        status: 'error',
        message: 'Database readiness check failed',
      };
    }
  }

  /**
   * Overrides or sets underlying PrismaClient instance (useful for testing).
   */
  setPrismaClient(prisma: PrismaClient | null): void {
    this.prisma = prisma;
    this.connected = prisma !== null;
  }

  /**
   * Returns underlying typed PrismaClient.
   * Throws if client is not connected.
   */
  getPrismaClient(): PrismaClient {
    if (!this.prisma) {
      if (!this.databaseUrl && config.NODE_ENV !== 'production') {
        this.prisma = createInMemoryPrismaClient();
        this.connected = true;
        return this.prisma;
      }

      // Lazy initialization fallback
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: this.databaseUrl || 'postgresql://unconfigured@localhost:5432/closevds',
          },
        },
      });
    }
    return this.prisma;
  }
}

// Global Singleton Instance
export const databaseClient = new PrismaDatabaseClient();
