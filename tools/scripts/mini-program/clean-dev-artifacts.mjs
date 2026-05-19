import { cleanMpWeixinArtifacts, getLogPrefix } from './shared.mjs';

cleanMpWeixinArtifacts();
console.log(`${getLogPrefix()} cleaned dev artifacts`);
