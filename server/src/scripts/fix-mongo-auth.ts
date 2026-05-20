import { MongoClient } from 'mongodb'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value ? value : fallback
}

function buildRootMongoUri(): string {
  const overrideUri = process.env.MONGO_ROOT_URI?.trim()
  if (overrideUri) {
    return overrideUri
  }

  const host = optionalEnv('MONGO_HOST', 'mongo')
  const port = optionalEnv('MONGO_PORT', '27017')
  const username = encodeURIComponent(requiredEnv('MONGO_ROOT_USERNAME'))
  const password = encodeURIComponent(requiredEnv('MONGO_ROOT_PASSWORD'))

  return `mongodb://${username}:${password}@${host}:${port}/admin?authSource=admin`
}

async function main(): Promise<void> {
  const appDbName = optionalEnv('MONGO_APP_DATABASE', 'harmony')
  const appUsername = requiredEnv('MONGO_APP_USERNAME')
  const appPassword = requiredEnv('MONGO_APP_PASSWORD')
  const mongoUri = buildRootMongoUri()

  console.log(`[mongo-fix-auth] connecting to MongoDB as root against ${appDbName}`)

  const client = new MongoClient(mongoUri)
  await client.connect()

  try {
    const appDb = client.db(appDbName)
    const role = { role: 'readWrite', db: appDbName }

    const usersInfo = await appDb.command({
      usersInfo: { user: appUsername, db: appDbName },
    })
    const userExists = Array.isArray(usersInfo.users) && usersInfo.users.length > 0

    if (userExists) {
      await appDb.command({
        updateUser: appUsername,
        pwd: appPassword,
        roles: [role],
      })
      console.log(`[mongo-fix-auth] updated app user "${appUsername}" on database "${appDbName}"`)
    } else {
      await appDb.command({
        createUser: appUsername,
        pwd: appPassword,
        roles: [role],
      })
      console.log(`[mongo-fix-auth] created app user "${appUsername}" on database "${appDbName}"`)
    }

    console.log('[mongo-fix-auth] done')
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error('[mongo-fix-auth] failed', error)
  process.exitCode = 1
})
