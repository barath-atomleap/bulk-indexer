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
import mqtt, { Client } from 'mqtt'
import sanitize from 'mongo-sanitize'
import { MongoClient } from 'mongodb'
import { IndexRequest, IndexResponse } from '../proto/indexer_pb'
export class IndexJobRequest {
  @IsDefined()
  @IsObject()
  query: any

  @IsOptional()
  @IsNumber()
  limit?: number
}
const dbClient = new MongoClient(config.database.connectionString, {
  useUnifiedTopology: true,
})
const index = async (job: Job<IndexJobRequest>) => {
  const collection = dbClient
    .db(config.database.database)
    .collection('companies')
  const query = sanitize(job.data.query)
  logger.info(
    `querying for ${JSON.stringify(query)} (limit: ${job.data.limit || 'none'})`
  )
  let cursor = collection.find(query)
  if (job.data.limit) {
    cursor = cursor.limit(job.data.limit)
  }
  const maxCount = await cursor.count(true)
  logger.info(`[#${job.id}] [query] found ${maxCount} results`)
  return new Promise((resolve) => {
    let count = 0
    cursor.stream().on('data', async (data) => {
      const companyId = data._id.toString()
      count = count += 1
      if (count % Math.floor(maxCount / 100) === 0 || count === maxCount) {
        await job.updateProgress({
          count,
          max: maxCount,
        })
      }
    })
    cursor.stream().on('end', () => {
      resolve()
    })
  })
}
const setupListeners = (worker: Worker, client: Client) => {
  worker.on('active', (job: Job<IndexJobRequest>) => {
    client.publish(
      `/jobs/${job.id}`,
      JSON.stringify({
        event: 'started',
      })
    )
    logger.info(`[#${job.id}] [started]`)
  })
  worker.on('completed', (job: Job<IndexJobRequest>) => {
    client.publish(
      `/jobs/${job.id}`,
      JSON.stringify({
        event: 'completed',
      })
    )
    logger.info(`[#${job.id}] [completed]`)
  })
  worker.on('failed', (job: Job<IndexJobRequest>, err: Error) => {
    client.publish(
      `/jobs/${job.id}`,
      JSON.stringify({
        event: 'failed',
        error: err,
      })
    )
    logger.error(`[#${job.id}] [failed] ${err.message}`)
  })
  worker.on('progress', (job: Job<IndexJobRequest>, progress: any) => {
    client.publish(
      `/jobs/${job.id}`,
      JSON.stringify({
        event: 'progress',
        data: progress,
      })
    )
  })
}
export const startIndexer = async (): Promise<Queue<IndexJobRequest>> => {
  await dbClient.connect()
  const client = mqtt.connect(config.mqtt)
  const queue = new Queue<IndexJobRequest>('indexer', {
    connection: config.redis,
  })
  const worker = new Worker('indexer', index, {
    concurrency: 100,
    connection: config.redis,
  })
  await worker.waitUntilReady()
  logger.info('connecting to mqtt')
  return new Promise((resolve) => {
    client.reconnect()
    setupListeners(worker, client)
    client.on('connect', () => {
      resolve(queue)
    })
  })
}

export const submit = async (input: IndexJobRequest, queue: Queue) => {
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
