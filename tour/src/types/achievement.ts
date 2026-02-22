export interface Achievement {
  id: string;
  title: string;
  description: string;
  progress: number; // 0-1
  scenicId?: string;
  achievedAt?: string;
}

export interface CheckinProgressItem {
  sceneId: string;
  sceneName?: string;
  checkedCount: number;
  totalCount: number;
  ratio: number;
}

export interface ScenicCheckinProgressItem {
  scenicId: string;
  sceneId: string;
  sceneName?: string;
  scenicTitle: string;
  coverImage?: string;
  slides?: string[];
  checkedCount: number;
  totalCount: number;
  ratio?: number;
}

export interface TravelSummaryItem {
  sceneId: string;
  sceneName?: string;
  visitedCount: number;
  totalDurationSeconds: number;
}

export interface TravelRecordItem {
  id: string;
  sceneId: string;
  sceneName?: string;
  enterTime: string;
  leaveTime?: string;
  durationSeconds?: number;
  achievementCount?: number;
  status: 'active' | 'completed';
}
