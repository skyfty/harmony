import Router from 'koa-router'
import { handleAssistantMessage } from '@/controllers/aiAssistantController'

const assistantRouter = new Router({ prefix: '/api/assistant' })

assistantRouter.post('/messages', handleAssistantMessage)

export default assistantRouter
