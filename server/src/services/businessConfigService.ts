import BusinessConfig from '../models/BusinessConfig';

export async function getBusinessConfig() {
  let config = await BusinessConfig.findOne();
  if (!config) {
    // 默认配置（可根据需要调整）
    config = await BusinessConfig.create({ contactPhone: '' });
  }
  return config;
}

export async function updateBusinessConfig(contactPhone: string) {
  let config = await BusinessConfig.findOne();
  if (!config) {
    config = await BusinessConfig.create({ contactPhone });
  } else {
    config.contactPhone = contactPhone;
    config.updatedAt = new Date();
    await config.save();
  }
  return config;
}
