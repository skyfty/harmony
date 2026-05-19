import { bootstrapApplication } from './bootstrap/application.mjs';

const [appName, scope, mode] = process.argv.slice(2);
bootstrapApplication(appName, scope, mode);
