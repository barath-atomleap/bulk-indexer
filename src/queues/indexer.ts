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
import sanitize from 'mongo-sanitize'
import { MongoClient } from 'mongodb'
import grpc, { ServiceError } from 'grpc'
import { IIndexerClient, IndexerClient } from '../proto/proto/indexer_grpc_pb'
import { IndexRequest } from '../proto/proto/indexer_pb'
import { connect, Client } from 'ts-nats'
export class IndexJobRequest {
  @IsDefined()
  @IsObject()
  query: any

  @IsOptional()
  @IsNumber()
  limit?: number

  @IsOptional()
  errors: { [key: string]: ServiceError }
}
const dbClient = new MongoClient(config.database.connectionString, {
  useUnifiedTopology: true,
})
const index = async (job: Job<IndexJobRequest>) => {
  job.data.errors = {}
  const indexerClient: IIndexerClient = new IndexerClient(
    config.indexer.address,
    grpc.credentials.createInsecure()
  )
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
    const errors: { [key: string]: ServiceError } = {}
    cursor.stream().on('data', async (data) => {
      const companyId = data._id.toString()
      const req = new IndexRequest()
      req.setCompanyId(companyId)
      indexerClient.index(req, async (error) => {
        if (error) {
          errors[companyId] = error
          job.data.errors[companyId] = error
        }
        count = count += 1
        if (count % Math.floor(maxCount / 100) === 0 || count === maxCount) {
          await job.updateProgress({
            count,
            max: maxCount,
            errors: job.data.errors,
          })
        }
        if (count === maxCount) {
          resolve({ errors })
        }
      })
    })
  })
}
const publishActive = async (client: Client, queue: Queue) => {
  const jobs = await queue.getActive()
  client.publish('active', JSON.stringify(jobs))
}
const setupListeners = (worker: Worker, client: Client, queue: Queue) => {
  worker.on('active', async (job: Job<IndexJobRequest>) => {
    await publishActive(client, queue)
    logger.info(`[#${job.id}] [started]`)
  })
  worker.on('completed', async (job: Job<IndexJobRequest>) => {
    await publishActive(client, queue)
    logger.info(`[#${job.id}] [completed]`)
  })
  worker.on('failed', async (job: Job<IndexJobRequest>, err: Error) => {
    await publishActive(client, queue)
    logger.error(`[#${job.id}] [failed] ${err.message}`)
  })
  worker.on('progress', async (job: Job<IndexJobRequest>, progress: any) => {
    await publishActive(client, queue)
    logger.info(`[#${job.id}] [progress] ${JSON.stringify(progress)}`)
  })
}
export const startIndexer = async (): Promise<Queue<IndexJobRequest>> => {
  await dbClient.connect()
  logger.info('connecting to nats')
  const client = await connect(config.nats)
  client.subscribe('connected', async () => {
    await publishActive(client, queue)
  })
  const queue = new Queue<IndexJobRequest>('indexer', {
    connection: config.redis,
  })
  const worker = new Worker('indexer', index, {
    concurrency: 100,
    connection: config.redis,
  })
  await worker.waitUntilReady()
  setupListeners(worker, client, queue)
  return queue
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
