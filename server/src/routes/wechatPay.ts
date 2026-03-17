import Router from 'koa-router'
import { koaBody } from '@/utils/bodyParser'
import { wechatPayNotify, wechatRefundNotify } from '@/controllers/wechatPayController'

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

wechatPayRouter.post(
  '/notify/:miniAppId',
  koaBody({
    json: true,
    urlencoded: false,
    text: false,
    includeUnparsed: true,
  }),
  wechatPayNotify,
)

wechatPayRouter.post(
  '/refund/notify',
  koaBody({
    json: true,
    urlencoded: false,
    text: false,
    includeUnparsed: true,
  }),
  wechatRefundNotify,
)

wechatPayRouter.post(
  '/refund/notify/:miniAppId',
  koaBody({
    json: true,
    urlencoded: false,
    text: false,
    includeUnparsed: true,
  }),
  wechatRefundNotify,
)

export default wechatPayRouter
