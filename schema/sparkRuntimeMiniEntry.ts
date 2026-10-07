// Type/compile-time shim for the mini-program lazy facade. Mini-program builds
// alias this specifier to an app-local entry under `pages/spark`; H5/editor
// builds alias the facade itself to the synchronous `sparkRuntime.ts`.
export * from './sparkRuntime';
