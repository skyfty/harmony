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
  checkpointTotal: number
  createdAt: string
  updatedAt: string
  bundle: Omit<UserSceneBundleInfo, 'fileKey'>
}

export interface UserSceneBundleRecord {
  id: string
  projectId: string
  checkpointTotal: number
  bundle: UserSceneBundleInfo
}
