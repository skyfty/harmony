const WECHAT_MINI_PROGRAM_APP_ID = 'wxbee5b017bdf26cc1'
const WECHAT_MINI_PROGRAM_SCENERY_PATH = 'pages/scenery/index'
const WECHAT_QR_RULE_LINK_BASE = 'https://v.touchmagic.cn'
const DEFAULT_VEHICLE_IDENTIFIER = 'default'

export interface BusinessOrderSharePayload {
  sceneId: string
  sceneSpotId: string
  sceneSpotTitle: string
  packageUrl: string
}

function buildWechatQuery(payload: BusinessOrderSharePayload): string {
  return `packageUrl=${encodeURIComponent(payload.packageUrl)}&sceneSpotId=${encodeURIComponent(payload.sceneSpotId)}&sceneId=${encodeURIComponent(payload.sceneId)}&scenicTitle=${encodeURIComponent(payload.sceneSpotTitle)}&vehicleIdentifier=${encodeURIComponent(DEFAULT_VEHICLE_IDENTIFIER)}`
}

export function buildBusinessOrderShareLinks(payload: BusinessOrderSharePayload) {
  const query = buildWechatQuery(payload)
  return {
    wechatRuleLink: `${WECHAT_QR_RULE_LINK_BASE}?${query}`,
    urlScheme: `weixin://dl/business/?appid=${WECHAT_MINI_PROGRAM_APP_ID}&path=${WECHAT_MINI_PROGRAM_SCENERY_PATH}&query=${encodeURIComponent(query)}&env_version=release`,
    miniProgramPath: `${WECHAT_MINI_PROGRAM_SCENERY_PATH}?${query}`,
  }
}

