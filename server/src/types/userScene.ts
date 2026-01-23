export type UserSceneBundleInfo = {
  url: string
  size: number
  etag: string
  updatedAt: string
  fileKey: string
}

export interface UserSceneSummary {
  id: string
  name: string
  projectId: string
  thumbnail: string | null
  createdAt: string
  updatedAt: string
  bundle: Omit<UserSceneBundleInfo, 'fileKey'>
}

export interface UserSceneBundleRecord {
  id: string
  projectId: string
  bundle: UserSceneBundleInfo
}
