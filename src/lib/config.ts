import { IsDefined, ValidateNested } from 'class-validator'
import { LoggerOptions } from 'bunyan'
import Redis from 'ioredis'
import { Type } from 'class-transformer'
class Database {
  @IsDefined()
  connectionString: string

  @IsDefined()
  database: string
}
export class Config {
  @IsDefined()
  logger: LoggerOptions

  @IsDefined()
  redis: Redis.RedisOptions

  @IsDefined()
  mqtt: string

  @IsDefined()
  @ValidateNested()
  @Type(() => Database)
  database: Database
}
