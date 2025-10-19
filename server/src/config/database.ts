import mongoose from 'mongoose'
import { appConfig } from './env'

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(appConfig.mongoUri)
  return mongoose
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}
