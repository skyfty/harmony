import Router from 'koa-router'
import {
  createContent,
  deleteContent,
  getContent,
  listContents,
  updateContent,
} from '@/controllers/contentController'
import { authMiddleware } from '@/middleware/auth'

const contentRouter = new Router({ prefix: '/api/contents' })

contentRouter.use(authMiddleware)
contentRouter.get('/', listContents)
contentRouter.get('/:id', getContent)
contentRouter.post('/', createContent)
contentRouter.put('/:id', updateContent)
contentRouter.delete('/:id', deleteContent)

export default contentRouter
