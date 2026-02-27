import Router from 'koa-router'
import { koaBody } from '@/utils/bodyParser'
import { wechatPayNotify } from '@/controllers/wechatPayController'

const wechatPayRouter = new Router({ prefix: '/wechat/pay' })

wechatPayRouter.post(
  '/notify',
  koaBody({
    json: true,
    urlencoded: false,
    text: false,
    includeUnparsed: true,
  }),
  wechatPayNotify,
)

export default wechatPayRouter
