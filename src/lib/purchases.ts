import { api } from "./api";

export type PurchaseStatus = "to_order" | "ordered" | "in_transit" | "delivered" | "cancelled";

export interface Purchase {
  id: number;
  project_id: number;
  item: string;
  supplier: string;
  cost: number;
  order_date: string | null;
  expected_date: string | null;
  arrival_date: string | null;
  status: PurchaseStatus;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseInput {
  item: string;
  supplier: string;
  cost: number;
  order_date: string | null;
  expected_date: string | null;
  arrival_date: string | null;
  status: PurchaseStatus;
}

export const listPurchases = (token: string | null) => api<Purchase[]>("/purchases", { token });

export const createPurchase = (token: string | null, body: PurchaseInput) =>
  api<Purchase>("/purchases", { method: "POST", body, token });

export const updatePurchase = (token: string | null, id: number, body: Partial<PurchaseInput>) =>
  api<Purchase>(`/purchases/${id}`, { method: "PATCH", body, token });

export const deletePurchase = (token: string | null, id: number) =>
  api<null>(`/purchases/${id}`, { method: "DELETE", token });

export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  to_order: "To order",
  ordered: "Ordered",
  in_transit: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const STATUS_CLS: Record<PurchaseStatus, string> = {
  to_order: "pill-todo",
  ordered: "pill-order",
  in_transit: "pill-prog",
  delivered: "pill-done",
  cancelled: "pill-cancel",
};

export const STATUS_ORDER: PurchaseStatus[] = [
  "to_order",
  "ordered",
  "in_transit",
  "delivered",
  "cancelled",
];

export const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
