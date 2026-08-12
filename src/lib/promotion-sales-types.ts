export type PromotionSalesStatus =
  | "Повністю відвантажений"
  | "відвантаження дозволено";

export type PromotionSalesPromotionInput = {
  id: number;
  idinc: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  productCodes: number[];
  publicUrl: string | null;
};

export type PromotionSalesBucket = {
  label: string;
  revenue: number;
};

export type PromotionSalesDailySummary = {
  date: string;
  total: {
    revenue: number;
    qty: number;
  };
  tile: {
    revenue: number;
    qty: number;
  };
  plumbing: {
    revenue: number;
    qty: number;
  };
};

export type PromotionSalesProductSummary = {
  code: string;
  name: string;
  url: string;
  brand: string;
  category: string;
  docs: number;
  qty: number;
  revenue: number;
};

export type PromotionSalesPublicGroup = {
  id: number;
  name: string;
  url: string;
  promotionIdincs: number[];
};

export type PromotionSalesPromotionSummary = {
  id: number;
  idinc: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  productCount: number;
  docs: number;
  revenue: number;
  publicUrl: string | null;
};

export type PromotionSalesDataset = {
  filter: {
    from: string;
    to: string;
    selectedPromotionIdincs: number[];
  };
  summary: {
    activePromotions: number;
    productCount: number;
    docs: number;
    revenue: number;
    plan: {
      month: string;
      plan: number | null;
      revenue: number;
      completionPct: number | null;
      segments: Array<{
        segment: "Плитка" | "Сантехніка";
        plan: number;
        revenue: number;
        completionPct: number | null;
      }>;
    };
    publicPromotionGroups: PromotionSalesPublicGroup[];
    daily: PromotionSalesDailySummary[];
    promotions: PromotionSalesPromotionSummary[];
    brands: PromotionSalesBucket[];
    categories: PromotionSalesBucket[];
    products: PromotionSalesProductSummary[];
    states: Array<{
      state: PromotionSalesStatus;
      docs: number;
      revenue: number;
    }>;
  };
};
