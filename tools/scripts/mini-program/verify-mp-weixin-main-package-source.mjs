import { getLogPrefix, verifyMpWeixinMainPackageSource } from './shared.mjs';

verifyMpWeixinMainPackageSource();
console.log(`${getLogPrefix()} verified mp-weixin main package source boundary`);
