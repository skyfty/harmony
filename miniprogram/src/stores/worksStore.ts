import { defineStore } from 'pinia';

export type WorkType = 'image' | 'video' | 'model';

export interface WorkItem {
  id: string;
  name: string;
  size: string;
  time: string;
  rating: number;
  likes: number;
  gradient: string;
  type: WorkType;
  collections: string[];
  description?: string;
  duration?: string;
}

export interface CollectionItem {
  id: string;
  title: string;
  description: string;
  cover: string;
  works: string[];
  createdAt: string;
  updatedAt: string;
}

interface NewWorkInput {
  name: string;
  size?: number | string;
  type: WorkType;
}

interface NewCollectionInput {
  title: string;
  description: string;
  cover?: string;
  workIds?: string[];
}

const gradientPalette = [
  'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
  'linear-gradient(135deg, #dff5ff, #c6ebff)',
  'linear-gradient(135deg, #fff0ce, #ffe2a8)',
  'linear-gradient(135deg, #e7e4ff, #f1eeff)',
  'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
  'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  'linear-gradient(135deg, #ffd59e, #ffe8c9)',
];

function formatSize(value?: number | string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && value > 0) {
    const mb = value / (1024 * 1024);
    return `${mb.toFixed(mb >= 100 ? 0 : 1)}MB`;
  }
  return '待处理';
}

function randomRating(): number {
  return Number((4.4 + Math.random() * 0.6).toFixed(1));
}

function randomLikes(): number {
  return Math.floor(120 + Math.random() * 220);
}

function pickGradient(index: number): string {
  return gradientPalette[index % gradientPalette.length];
}

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useWorksStore = defineStore('worksStore', {
  state: () => ({
    works: [
      {
        id: 'w1',
        name: '沉浸式雕塑',
        size: '24.8MB',
        time: '2 小时前',
        rating: 4.8,
        likes: 236,
        gradient: pickGradient(0),
        type: 'model' as WorkType,
        collections: ['c1'],
        description: '以柔和的光影与曲面结构构建沉浸式体验，适用于展厅主入口或核心展区。',
        duration: '3 分钟',
      },
      {
        id: 'w2',
        name: '未来展厅',
        size: '18.6MB',
        time: '昨天',
        rating: 4.6,
        likes: 198,
        gradient: pickGradient(1),
        type: 'model' as WorkType,
        collections: ['c1', 'c2'],
        description: '融合多维交互组件与空间灯光的未来主义展厅方案，突出科技感。',
        duration: '4 分钟',
      },
      {
        id: 'w3',
        name: '光影序曲',
        size: '12.4MB',
        time: '3 天前',
        rating: 4.9,
        likes: 321,
        gradient: pickGradient(2),
        type: 'video' as WorkType,
        collections: ['c2'],
        description: '以动态灯光和空间节奏营造开场氛围，适用于展览序厅与导览空间。',
        duration: '2 分钟',
      },
      {
        id: 'w4',
        name: '环境剧场',
        size: '27.3MB',
        time: '1 周前',
        rating: 4.7,
        likes: 178,
        gradient: pickGradient(3),
        type: 'model' as WorkType,
        collections: [],
        description: '通过多层级空间与背景音效打造沉浸式环境剧场，适合沉浸内容展示。',
        duration: '5 分钟',
      },
    ] as WorkItem[],
    collections: [
      {
        id: 'c1',
        title: '雕塑精选集',
        description: '精选雕塑作品，适用于展厅主展区展示。',
        cover: pickGradient(0),
        works: ['w1', 'w2'],
        createdAt: '2025-04-02',
        updatedAt: '2025-10-01',
      },
      {
        id: 'c2',
        title: '光影主题集',
        description: '强调光影变化与空间氛围的作品集合。',
        cover: pickGradient(2),
        works: ['w2', 'w3'],
        createdAt: '2025-05-12',
        updatedAt: '2025-09-18',
      },
    ] as CollectionItem[],
  }),
  getters: {
    workMap: (state) =>
      state.works.reduce<Record<string, WorkItem>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {}),
    collectionMap: (state) =>
      state.collections.reduce<Record<string, CollectionItem>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {}),
    worksByCollection: (state) => (collectionId?: string) => {
      if (!collectionId || collectionId === 'all') {
        return state.works;
      }
      return state.works.filter((work) => work.collections.includes(collectionId));
    },
  },
  actions: {
    addWorks(inputs: NewWorkInput[]): string[] {
      const now = new Date();
      const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')} 刚刚`;
      const newIds: string[] = [];
      inputs.forEach((input, index) => {
        const id = generateId('w');
        newIds.push(id);
        this.works.unshift({
          id,
          name: input.name,
          size: formatSize(input.size),
          time: timeLabel,
          rating: randomRating(),
          likes: randomLikes(),
          gradient: pickGradient(index),
          type: input.type,
          collections: [],
          description: '请补充作品描述，便于展览选择。',
          duration: '-',
        });
      });
      return newIds;
    },
    deleteWork(id: string) {
      this.works = this.works.filter((item) => item.id !== id);
      this.collections = this.collections.map((collection) => ({
        ...collection,
        works: collection.works.filter((workId) => workId !== id),
      }));
    },
    addWorksToCollection(workIds: string[], collectionId: string) {
      const target = this.collectionMap[collectionId];
      if (!target) {
        return;
      }
      const unique = new Set([...target.works, ...workIds]);
      target.works = Array.from(unique);
      target.updatedAt = new Date().toISOString().slice(0, 10);
      this.collections = this.collections.map((item) => (item.id === target.id ? { ...target } : item));
      this.works = this.works.map((work) =>
        workIds.includes(work.id)
          ? { ...work, collections: Array.from(new Set([...work.collections, collectionId])) }
          : work,
      );
    },
    removeWorkFromCollection(workId: string, collectionId: string) {
      this.collections = this.collections.map((collection) => {
        if (collection.id !== collectionId) {
          return collection;
        }
        const works = collection.works.filter((id) => id !== workId);
        return { ...collection, works, updatedAt: new Date().toISOString().slice(0, 10) };
      });
      this.works = this.works.map((work) =>
        work.id === workId
          ? { ...work, collections: work.collections.filter((cid) => cid !== collectionId) }
          : work,
      );
    },
    createCollection(input: NewCollectionInput): string {
      const id = generateId('c');
      const today = new Date().toISOString().slice(0, 10);
      const cover = input.cover || pickGradient(Math.floor(Math.random() * gradientPalette.length));
      const workIds = Array.from(new Set(input.workIds ?? []));
      const collection: CollectionItem = {
        id,
        title: input.title,
        description: input.description,
        cover,
        works: workIds,
        createdAt: today,
        updatedAt: today,
      };
      this.collections.unshift(collection);
      if (workIds.length) {
        this.works = this.works.map((work) =>
          workIds.includes(work.id)
            ? { ...work, collections: Array.from(new Set([...work.collections, id])) }
            : work,
        );
      }
      return id;
    },
    updateCollection(collectionId: string, payload: Partial<Omit<CollectionItem, 'id' | 'works'>>) {
      const target = this.collectionMap[collectionId];
      if (!target) {
        return;
      }
      const updated: CollectionItem = {
        ...target,
        ...payload,
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      this.collections = this.collections.map((item) => (item.id === collectionId ? updated : item));
    },
  },
});
