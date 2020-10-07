import { IsDefined } from 'class-validator'
import { LoggerOptions } from 'bunyan'
import Redis from 'ioredis'
export class Config {
  @IsDefined()
  logger: LoggerOptions

  @IsDefined()
  redis: Redis.RedisOptions
}
