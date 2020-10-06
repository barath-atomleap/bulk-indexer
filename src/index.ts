import { loadConfig } from '@delphai/typed-config'
import { Config } from './lib/config'
import bunyan from 'bunyan'
export const config = loadConfig(Config)
export const logger = bunyan.createLogger(config.logger)

logger.info(config)
