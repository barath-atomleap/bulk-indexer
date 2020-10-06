import { IsDefined } from 'class-validator'
import { LoggerOptions } from 'bunyan'
export class Config {
  @IsDefined()
  logger: LoggerOptions
}
