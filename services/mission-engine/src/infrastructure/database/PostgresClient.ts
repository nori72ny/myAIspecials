import pg from "pg";

const { Pool } = pg;

export class PostgresClient {
  private static instance: PostgresClient | null = null;
  private pool: pg.Pool | null = null;

  private constructor() {
    // Lazy initialization
  }

  public static getInstance(): PostgresClient {
    if (!this.instance) {
      this.instance = new PostgresClient();
    }
    return this.instance;
  }

  public getPool(): pg.Pool {
    if (!this.pool) {
      const connectionString = process.env.DATABASE_URL;
      
      if (connectionString) {
        console.log("Initializing PostgreSQL pool using DATABASE_URL...");
        this.pool = new Pool({
          connectionString,
          ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
      } else {
        const host = process.env.POSTGRES_HOST || "localhost";
        const port = parseInt(process.env.POSTGRES_PORT || "5432", 10);
        const user = process.env.POSTGRES_USER || "postgres";
        const password = process.env.POSTGRES_PASSWORD || "postgres";
        const database = process.env.POSTGRES_DB || "acos";

        console.log(`Initializing PostgreSQL pool with individual configs (${host}:${port}/${database})...`);
        this.pool = new Pool({
          host,
          port,
          user,
          password,
          database });
      }

      // Add pool error handler to prevent crashing the process on unexpected errors
      this.pool.on("error", (err) => {
        console.error("Unexpected error on idle PostgreSQL client", err);
      });
    }
    return this.pool;
  }

  public async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const client = await this.getPool().connect();
      try {
        const res = await client.query("SELECT NOW()");
        return { connected: true };
      } finally {
        client.release();
      }
    } catch (err: any) {
      return { connected: false, error: err.message || String(err) };
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log("PostgreSQL connection pool closed.");
    }
  }
}
