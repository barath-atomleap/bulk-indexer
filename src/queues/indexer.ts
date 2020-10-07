import { getMessages } from '@delphai/typed-config'
import { Job, Queue, Worker } from 'bullmq'
import {
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  validate,
  ValidationError,
} from 'class-validator'
import { createError } from 'micro'
import { config, logger } from '..'

export class IndexRequest {
  @IsDefined()
  @IsObject()
  query: any

  @IsOptional()
  @IsNumber()
  limit?: number
}

export const startIndexer = async () => {
  const queue = new Queue<IndexRequest>('indexer', {
    connection: config.redis,
  })
  const worker = new Worker(
    'indexer',
    async (job) => {
      logger.info(job.data)
    },
    {
      concurrency: 100,
      connection: config.redis,
    }
  )
  worker.on('active', (job: Job<IndexRequest>) => {
    logger.info(`[#${job.id}] [started]`)
  })
  worker.on('completed', (job: Job<IndexRequest>) => {
    logger.info(`[#${job.id}] [completed]`)
  })
  worker.on('failed', (job: Job<IndexRequest>, err: Error) => {
    logger.error(`[#${job.id}] [failed] ${err.message}`)
  })
  worker.on('progress', (job: Job<IndexRequest>, progress: any) => {
    logger.info(`[#${job.id}] [progress] ${progress}`)
  })
  await worker.waitUntilReady()
  return queue
}

export const submit = async (input: IndexRequest, queue: Queue) => {
  const errors = await validate(input, {
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    whitelist: true,
  })
  if (errors.length > 0) {
    const messages = []
    errors.forEach((err: ValidationError) => getMessages(messages, err))
    throw createError(400, messages.join(', '))
  } else {
    const job = await queue.add('indexer', input)
    return job
  }
}
