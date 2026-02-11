type WxFileSystemManagerLike = {
  accessSync?: (path: string) => void;
  mkdirSync?: (path: string, recursive?: boolean) => void;
  readFileSync?: (filePath: string, encoding?: string) => string | ArrayBuffer;
  writeFileSync?: (filePath: string, data: ArrayBuffer, encoding?: string) => void;
  unlinkSync?: (filePath: string) => void;
};

function getWxFileSystemManager(): WxFileSystemManagerLike {
  const wxAny = (typeof wx !== 'undefined' ? (wx as any) : null) as any;
  if (!wxAny || typeof wxAny.getFileSystemManager !== 'function') {
    throw new Error('当前环境不支持微信文件系统（getFileSystemManager 不存在）');
  }
  return wxAny.getFileSystemManager() as WxFileSystemManagerLike;
}

function getUserDataPath(): string {
  const wxAny = (typeof wx !== 'undefined' ? (wx as any) : null) as any;
  const path = wxAny?.env?.USER_DATA_PATH;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('无法获取 USER_DATA_PATH');
  }
  return path;
}

function normalizeToArrayBuffer(input: ArrayBuffer | Uint8Array | any): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return (input.buffer as any).slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  return input as ArrayBuffer;
}

function ensureDirExistsSync(dirPath: string): void {
  const fs = getWxFileSystemManager();
  fs.mkdirSync(dirPath, true);
}

const SCENE_PACKAGE_DIR_NAME = 'harmony/scene-packages';

export function resolveScenePackageDir(): string {
  const base = getUserDataPath().replace(/\/$/, '');
  return `${base}/${SCENE_PACKAGE_DIR_NAME}`;
}

export function resolveScenePackageZipPath(projectId: string): string {
  const safeId = String(projectId ?? '').trim() || 'project';
  const dir = resolveScenePackageDir();
  return `${dir}/${safeId}.zip`;
}

export function writeScenePackageZipSync(bytes: ArrayBuffer | Uint8Array, projectId: string): string {
  const fs = getWxFileSystemManager();
  if (typeof fs.writeFileSync !== 'function') {
    throw new Error('当前环境不支持 writeFileSync');
  }

  const dir = resolveScenePackageDir();
  ensureDirExistsSync(dir);
  const filePath = resolveScenePackageZipPath(projectId);
  const buffer = normalizeToArrayBuffer(bytes);
  fs.writeFileSync(filePath, buffer as any);
  return filePath;
}

export function readScenePackageZipSync(filePath: string): ArrayBuffer {
  const fs = getWxFileSystemManager();
  if (typeof fs.readFileSync !== 'function') {
    throw new Error('当前环境不支持 readFileSync');
  }
  const result = fs.readFileSync(filePath as any);
  if (result instanceof ArrayBuffer) {
    return result;
  }
  throw new Error('读取场景包失败（返回不是 ArrayBuffer）');
}

export function removeScenePackageZipSync(filePath: string | null | undefined): void {
  const trimmed = typeof filePath === 'string' ? filePath.trim() : '';
  if (!trimmed) return;

  try {
    const fs = getWxFileSystemManager();
    if (typeof fs.unlinkSync === 'function') {
      fs.unlinkSync(trimmed);
    }
  } catch (_e) {
    // Ignore cleanup failures.
  }
}
