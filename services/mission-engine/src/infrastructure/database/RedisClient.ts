import { createClient, RedisClientType } from "redis";

export class RedisClient {
  private static instance: RedisClient | null = null;
  private client: any = null;
  private isConnecting = false;

  private constructor() {}

  public static getInstance(): RedisClient {
    if (!this.instance) {
      this.instance = new RedisClient();
    }
    return this.instance;
  }

  public getClient() {
    if (!this.client) {
      const url = process.env.REDIS_URL || "redis://localhost:6379";
      console.log(`Initializing Redis client with URL: ${url}`);
      
      this.client = createClient({ url });

      this.client.on("error", (err: any) => {
        // Log redis error without throwing to keep application stable
        console.error("Redis Client Error", err);
      });
    }
    return this.client;
  }

  public async connect(): Promise<void> {
    const client = this.getClient();
    if (this.isConnecting || client.isOpen) {
      return;
    }

    try {
      this.isConnecting = true;
      await client.connect();
      console.log("Successfully connected to Redis.");
    } catch (err) {
      console.error("Failed to connect to Redis, continuing in degraded state:", err);
    } finally {
      this.isConnecting = false;
    }
  }

  public async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const client = this.getClient();
      if (!client.isOpen) {
        await this.connect();
      }
      
      if (client.isOpen) {
        await client.ping();
        return { connected: true };
      } else {
        return { connected: false, error: "Redis client is not open" };
      }
    } catch (err: any) {
      return { connected: false, error: err.message || String(err) };
    }
  }

  public async close(): Promise<void> {
    if (this.client && this.client.isOpen) {
      await this.client.quit();
      this.client = null;
      console.log("Redis client connection closed.");
    }
  }
}
