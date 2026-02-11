export interface Achievement {
  id: string;
  title: string;
  description: string;
  progress: number; // 0-1
  scenicId?: string;
}
