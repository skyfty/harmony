import Router from 'koa-router'
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
  updateUserStatus,
} from '@/controllers/userController'
import { authMiddleware } from '@/middleware/auth'

const userRouter = new Router({ prefix: '/api/users' })

userRouter.use(authMiddleware)
userRouter.get('/', listUsers)
userRouter.get('/:id', getUser)
userRouter.post('/', createUser)
userRouter.put('/:id', updateUser)
userRouter.delete('/:id', deleteUser)
userRouter.patch('/:id/status', updateUserStatus)
userRouter.put('/:id/status', updateUserStatus)

export default userRouter
