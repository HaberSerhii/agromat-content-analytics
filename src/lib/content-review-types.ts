export const CONTENT_REVIEW_MANAGERS = [
  "Матвійчук Н.",
  "Майборода Н.",
] as const;

export const CONTENT_REVIEW_ACTIONS = [
  "Назва товару",
  "Обов'язкові атрибути",
  "Відгуки",
  "Фото-контент",
  "Сортування каталогу",
  "Сортування в пошуковій системі",
  "Сортування в акції",
  "Пошуковий запит",
] as const;

export type ContentReviewManager = (typeof CONTENT_REVIEW_MANAGERS)[number];
export type ContentReviewAction = (typeof CONTENT_REVIEW_ACTIONS)[number];

export interface ContentReviewMetrics {
  impressions: number;
  ctr: number | null;
  atc: number | null;
  contentScore: number | null;
  categoryCtr: number | null;
  categoryAtc: number | null;
  categoryContent: number | null;
  periodFrom?: string;
  periodTo?: string;
}

export interface ContentProductReview {
  id: string;
  productId: number;
  code: number;
  goodsRef: number;
  name: string;
  url: string;
  categoryId: number;
  categoryName: string;
  brand: string;
  manager: ContentReviewManager;
  actions: ContentReviewAction[];
  changedAt: string;
  checkAt: string;
  before: ContentReviewMetrics;
  after: ContentReviewMetrics | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isContentReviewManager(
  value: unknown,
): value is ContentReviewManager {
  return CONTENT_REVIEW_MANAGERS.includes(value as ContentReviewManager);
}

export function isContentReviewAction(
  value: unknown,
): value is ContentReviewAction {
  return CONTENT_REVIEW_ACTIONS.includes(value as ContentReviewAction);
}
