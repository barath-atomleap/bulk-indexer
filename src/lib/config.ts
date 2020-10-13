import { IsDefined, IsNumber, Max, Min, ValidateNested } from 'class-validator'
import { LoggerOptions } from 'bunyan'
import Redis from 'ioredis'
import { Type } from 'class-transformer'
class Server {
  @IsDefined()
  @IsNumber()
  @Max(65536)
  @Min(1024)
  port: number
}
class Database {
  @IsDefined()
  connectionString: string

  @IsDefined()
  database: string
}

class Nats {
  @IsDefined()
  url: string

  @IsDefined()
  json: boolean
}
class Indexer {
  @IsDefined()
  address: string
}
export class Config {
  @IsDefined()
  logger: LoggerOptions

  @IsDefined()
  redis: Redis.RedisOptions

  @IsDefined()
  @ValidateNested()
  @Type(() => Nats)
  nats: Nats

  @IsDefined()
  @ValidateNested()
  @Type(() => Database)
  database: Database

  @IsDefined()
  @ValidateNested()
  @Type(() => Indexer)
  indexer: Indexer

  @IsDefined()
  @ValidateNested()
  @Type(() => Server)
  server: Server
}
