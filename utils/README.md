# @harmony/utils

This package contains shared runtime helpers used across viewer, scenery and exhibition projects.

Notes:
- `scenePackageFs` relies on WeChat mini program globals `wx.getFileSystemManager()` and `wx.env.USER_DATA_PATH`.
- `scenePackageStorage` will fall back to `IndexedDB` in non-WeChat environments.
- Ensure consumers include `DOM` lib in TypeScript so `indexedDB` and `IDBDatabase` types resolve.
