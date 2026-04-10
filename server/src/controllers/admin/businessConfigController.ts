import { Context } from 'koa';
import * as businessConfigService from '../../services/businessConfigService';

export async function getBusinessConfig(ctx: Context) {
  const config = await businessConfigService.getBusinessConfig();
  ctx.body = {
    success: true,
    data: {
      contactPhone: config.contactPhone,
      updatedAt: config.updatedAt,
    },
  };
}

export async function updateBusinessConfig(ctx: Context) {
  const { contactPhone } = ctx.request.body;
  if (typeof contactPhone !== 'string' || !contactPhone) {
    ctx.throw(400, 'contactPhone is required');
  }
  const config = await businessConfigService.updateBusinessConfig(contactPhone);
  ctx.body = {
    success: true,
    data: {
      contactPhone: config.contactPhone,
      updatedAt: config.updatedAt,
    },
  };
}
