export type ScenicCommentStatus = 'pending' | 'approved' | 'rejected'

export interface ScenicComment {
  id: string;
  sceneSpotId: string;
  userId: string;
  userDisplayName: string;
  content: string;
  status: ScenicCommentStatus;
  rejectReason?: null | string;
  reviewedAt?: null | string;
  isMine?: boolean;
  canDelete?: boolean;
  createdAt: string;
  updatedAt: string;
}
