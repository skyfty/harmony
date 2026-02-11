export type FeedbackCategory = 'bug' | 'ui' | 'feature' | 'content' | 'other';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'closed';

export interface FeedbackTicket {
  id: string;
  category: FeedbackCategory;
  content: string;
  contact?: string;
  createdAt: string;
  status: FeedbackStatus;
  reply?: string;
}
