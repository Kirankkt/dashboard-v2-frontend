import { useState } from "react";
import type { FormEvent } from "react";
import type { Purchase, PurchaseInput, PurchaseStatus } from "../lib/purchases";
import { STATUS_LABEL, STATUS_ORDER } from "../lib/purchases";
import type { ApiError } from "../lib/api";
import { IconClose, IconChevronDown } from "./icons";

interface Props {
  initial: Purchase | null;
  onClose: () => void;
  onSubmit: (data: PurchaseInput) => Promise<void>;
}

export function PurchaseModal({ initial, onClose, onSubmit }: Props) {
  const [item, setItem] = useState(initial?.item ?? "");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [cost, setCost] = useState(String(initial?.cost ?? ""));
  const [status, setStatus] = useState<PurchaseStatus>(initial?.status ?? "to_order");
  const [orderDate, setOrderDate] = useState(initial?.order_date ?? "");
  const [expectedDate, setExpectedDate] = useState(initial?.expected_date ?? "");
  const [arrivalDate, setArrivalDate] = useState(initial?.arrival_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        item: item.trim(),
        supplier: supplier.trim(),
        cost: Number(cost) || 0,
        status,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        arrival_date: arrivalDate || null,
      });
    } catch (err) {
      setError((err as ApiError)?.message ?? "Could not save order");
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={initial ? "Edit order" : "New order"}>
        <div className="modal-head">
          <h2>{initial ? "Edit order" : "New order"}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <form onSubmit={submit} style={{ display: "contents" }}>
          <div className="modal-body">
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="field">
              <label className="label" htmlFor="p-item">Item / material</label>
              <input id="p-item" className="input" value={item} onChange={(e) => setItem(e.target.value)} required placeholder="e.g. Cement OPC 53 (50 bags)" />
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label" htmlFor="p-supplier">Supplier</label>
                <input id="p-supplier" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. BuildMart" />
              </div>
              <div className="field">
                <label className="label" htmlFor="p-cost">Cost (₹)</label>
                <input id="p-cost" className="input" type="number" min="0" step="1" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="p-status">Status</label>
              <div className="select-wrap">
                <select id="p-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as PurchaseStatus)}>
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <IconChevronDown />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label" htmlFor="p-order">Order date</label>
                <input id="p-order" className="input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="p-expected">Expected arrival</label>
                <input id="p-expected" className="input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="p-arrival">Actual arrival</label>
              <input id="p-arrival" className="input" type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : initial ? "Save changes" : "Add order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
