import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

type ZRangeOptions = { byScore?: boolean; rev?: boolean };
type RedisSetOptions = { ex?: number };
type SortedSetMember = { score: number; member: string };

interface RedisPipelineLike {
  get(key: string): RedisPipelineLike;
  zrange(key: string, start: number, stop: number, opts?: ZRangeOptions): RedisPipelineLike;
  exec(): Promise<unknown[]>;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: RedisSetOptions): Promise<unknown>;
  del(key: string): Promise<unknown>;
  zadd(key: string, first: SortedSetMember, ...rest: SortedSetMember[]): Promise<unknown>;
  zrange(key: string, start: number, stop: number, opts?: ZRangeOptions): Promise<string[]>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  pipeline(): RedisPipelineLike;
}

class IORedisPipelineAdapter implements RedisPipelineLike {
  constructor(private readonly pipe: ReturnType<IORedis["pipeline"]>) {}

  get(key: string): RedisPipelineLike {
    this.pipe.get(key);
    return this;
  }

  zrange(key: string, start: number, stop: number, opts?: ZRangeOptions): RedisPipelineLike {
    if (opts?.byScore) {
      if (opts.rev) {
        this.pipe.zrevrangebyscore(key, String(start), String(stop));
      } else {
        this.pipe.zrangebyscore(key, String(start), String(stop));
      }
    } else {
      this.pipe.zrange(key, start, stop);
    }
    return this;
  }

  async exec(): Promise<unknown[]> {
    const rows = await this.pipe.exec();
    return (rows ?? []).map(([err, value]) => {
      if (err) throw err;
      return value;
    });
  }
}

class IORedisAdapter implements RedisLike {
  private readonly client: IORedis;

  constructor(url: string) {
    this.client = new IORedis(url, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    });
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  set(key: string, value: string, opts?: RedisSetOptions): Promise<unknown> {
    if (opts?.ex) return this.client.set(key, value, "EX", opts.ex);
    return this.client.set(key, value);
  }

  del(key: string): Promise<unknown> {
    return this.client.del(key);
  }

  zadd(key: string, first: SortedSetMember, ...rest: SortedSetMember[]): Promise<unknown> {
    const members = [first, ...rest];
    const args = members.flatMap((m) => [String(m.score), m.member]);
    return this.client.zadd(key, ...args);
  }

  zrange(key: string, start: number, stop: number, opts?: ZRangeOptions): Promise<string[]> {
    if (opts?.byScore) {
      if (opts.rev) {
        return this.client.zrevrangebyscore(key, String(start), String(stop));
      }
      return this.client.zrangebyscore(key, String(start), String(stop));
    }
    return this.client.zrange(key, start, stop);
  }

  zremrangebyscore(key: string, min: number, max: number): Promise<unknown> {
    return this.client.zremrangebyscore(key, String(min), String(max));
  }

  pipeline(): RedisPipelineLike {
    return new IORedisPipelineAdapter(this.client.pipeline());
  }
}

declare global {
  var _redis: RedisLike | undefined;
}

export function getRedis(): RedisLike {
  if (!global._redis) {
    if (process.env.REDIS_URL) {
      global._redis = new IORedisAdapter(process.env.REDIS_URL);
    } else {
      global._redis = new UpstashRedis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        automaticDeserialization: false,
      }) as unknown as RedisLike;
    }
  }
  return global._redis;
}
