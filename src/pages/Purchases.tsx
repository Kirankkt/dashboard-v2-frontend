import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Menu } from "../components/Menu";
import { PurchaseModal } from "../components/PurchaseModal";
import { useAuth } from "../auth/AuthContext";
import { IconCart, IconPlus, IconMore, IconEdit, IconTrash, IconChevronDown } from "../components/icons";
import {
  listPurchases, createPurchase, updatePurchase, deletePurchase,
  STATUS_LABEL, STATUS_CLS, STATUS_ORDER, fmtINR,
} from "../lib/purchases";
import type { Purchase, PurchaseStatus, PurchaseInput } from "../lib/purchases";
import { fmtShort } from "../lib/dates";
import type { ApiError } from "../lib/api";

type Filter = "all" | PurchaseStatus;

function StatusMenu({ value, onChange }: { value: PurchaseStatus; onChange: (s: PurchaseStatus) => void }) {
  return (
    <Menu
      triggerClassName={`pill pill-btn pill-caret ${STATUS_CLS[value]}`}
      triggerLabel="Change order status"
      align="start"
      trigger={<>{STATUS_LABEL[value]}<IconChevronDown /></>}
    >
      {(close) =>
        STATUS_ORDER.map((s) => (
          <button key={s} type="button" role="menuitem" onClick={() => { onChange(s); close(); }}>
            <span className={`pill ${STATUS_CLS[s]}`} style={{ pointerEvents: "none" }}>{STATUS_LABEL[s]}</span>
          </button>
        ))
      }
    </Menu>
  );
}

export default function Purchases() {
  const { token, user } = useAuth();
  const canDelete = user?.role === "contractor";

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<{ open: boolean; purchase: Purchase | null }>({ open: false, purchase: null });

  useEffect(() => {
    listPurchases(token)
      .then(setPurchases)
      .catch((e) => setError((e as ApiError)?.message ?? "Could not load orders"))
      .finally(() => setLoading(false));
  }, [token]);

  const stats = useMemo(() => {
    const active = purchases.filter((p) => p.status !== "cancelled");
    return {
      items: active.length,
      spend: active.reduce((s, p) => s + p.cost, 0),
      inTransit: purchases.filter((p) => p.status === "ordered" || p.status === "in_transit").length,
      delivered: purchases.filter((p) => p.status === "delivered").length,
    };
  }, [purchases]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: purchases.length, to_order: 0, ordered: 0, in_transit: 0, delivered: 0, cancelled: 0 };
    for (const p of purchases) c[p.status]++;
    return c;
  }, [purchases]);

  const visible = useMemo(
    () => (filter === "all" ? purchases : purchases.filter((p) => p.status === filter)),
    [purchases, filter],
  );

  async function changeStatus(p: Purchase, status: PurchaseStatus) {
    try {
      const u = await updatePurchase(token, p.id, { status });
      setPurchases((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not update status");
    }
  }
  async function submit(data: PurchaseInput) {
    if (modal.purchase) {
      const u = await updatePurchase(token, modal.purchase.id, data);
      setPurchases((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } else {
      const created = await createPurchase(token, data);
      setPurchases((prev) => [created, ...prev]);
    }
    setModal({ open: false, purchase: null });
  }
  async function remove(p: Purchase) {
    if (!window.confirm(`Delete “${p.item}”? This can't be undone.`)) return;
    try {
      await deletePurchase(token, p.id);
      setPurchases((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not delete order");
    }
  }

  const chips: [Filter, string, number][] = [
    ["all", "All", counts.all],
    ...STATUS_ORDER.map((s): [Filter, string, number] => [s, STATUS_LABEL[s], counts[s]]),
  ];

  return (
    <AppShell
      title="Buying & Selling"
      titleIcon={<IconCart />}
      actions={
        <button className="btn btn-primary" type="button" onClick={() => setModal({ open: true, purchase: null })}>
          <IconPlus />Add order
        </button>
      }
    >
      {error && <div className="error-banner">{error}</div>}

      <div className="stat-row stat-row-4">
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--accent)" }} />Materials tracked</div><div className="v">{stats.items}</div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--accent)" }} />Committed spend</div><div className="v stat-money">{fmtINR(stats.spend)}</div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--prog-fg)" }} />On the way</div><div className="v">{stats.inTransit}</div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--done-fg)" }} />Delivered</div><div className="v">{stats.delivered}</div></div>
      </div>

      <div className="filter-bar">
        <div className="chips" role="group" aria-label="Filter by status">
          {chips.map(([key, label, n]) => (
            <button key={key} type="button" className="chip-btn" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label} <span className="count">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="data-card">
        {loading ? (
          <div className="empty">Loading orders…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <h3>{filter === "all" ? "No orders yet" : "Nothing here"}</h3>
            <p className="hint">Track materials from order to delivery — add your first one.</p>
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl tbl-cards">
              <thead>
                <tr>
                  <th>Item</th><th>Cost</th><th>Ordered</th><th>Expected</th><th>Arrived</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Item"><div className="t-name">{p.item}</div><div className="t-sub">{p.supplier || "—"}</div></td>
                    <td data-label="Cost" className="num">{fmtINR(p.cost)}</td>
                    <td data-label="Ordered" className="num">{fmtShort(p.order_date)}</td>
                    <td data-label="Expected" className="num">{fmtShort(p.expected_date)}</td>
                    <td data-label="Arrived" className="num">
                      {p.arrival_date ? fmtShort(p.arrival_date) : p.status === "delivered" ? "✓" : "—"}
                    </td>
                    <td data-label="Status"><StatusMenu value={p.status} onChange={(s) => changeStatus(p, s)} /></td>
                    <td className="td-actions">
                      <Menu triggerClassName="row-more" triggerLabel="Order actions" trigger={<IconMore />}>
                        {(close) => (
                          <>
                            <button type="button" onClick={() => { setModal({ open: true, purchase: p }); close(); }}><IconEdit />Edit</button>
                            {canDelete && (
                              <>
                                <div className="menu-sep" />
                                <button type="button" className="danger" onClick={() => { close(); remove(p); }}><IconTrash />Delete</button>
                              </>
                            )}
                          </>
                        )}
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.open && (
        <PurchaseModal initial={modal.purchase} onClose={() => setModal({ open: false, purchase: null })} onSubmit={submit} />
      )}
    </AppShell>
  );
}
