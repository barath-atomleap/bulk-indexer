import { loadConfig } from '@delphai/typed-config'
import { Config } from './lib/config'
import bunyan from 'bunyan'
export const config = loadConfig(Config)
export const logger = bunyan.createLogger(config.logger)
import Router from 'micro-ex-router'
import { handleErrors } from 'micro-boom'
import micro, { createError, RequestHandler } from 'micro'
import { IndexRequest, startIndexer, submit } from './queues/indexer'
import { plainToClass } from 'class-transformer'
const start = async () => {
  const indexerQueue = await startIndexer()
  const defaultOptions = {
    parseBody: true, // Tells the router to parse the body by default
    limit: '1mb', // How much data is aggregated before parsing at max. It can be a Number of bytes or a string like '1mb'.
    encoding: 'utf8',
    acceptedMethods: [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'head',
      'options',
      'use',
    ], // The methods that will be handled by the router
  }

  const handler: RequestHandler = async (req: any) => {
    const input = plainToClass(IndexRequest, req.body)
    return await submit(input, indexerQueue)
  }
  const router = Router(defaultOptions)
  router.post('/', handler).use(() => {
    throw createError(404, 'page not found')
  })
  const app = micro(handleErrors(router))

  app.listen(3000, () => {
    logger.info('started bulk indexer server on port 3000')
  })
}

if (require.main === module) {
  start()
}
