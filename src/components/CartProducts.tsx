"use client";
import { useEffect, useState } from "react";
import type { ApiCart } from "@/lib/cart-types";

const money = (value: number) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value) + " ₴";

export default function CartProducts({ cart }: { cart: ApiCart }) {
  const [linked, setLinked] = useState<ApiCart | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLinked(null);
    fetch(`/api/sales/carts?${new URLSearchParams({ cart_id: String(cart.id) })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => response.ok ? (await response.json()).data as ApiCart : null)
      .then(value => { if (!controller.signal.aborted) setLinked(value); })
      .catch(() => { /* Existing product details remain visible if links cannot load. */ });
    return () => controller.abort();
  }, [cart.id]);
  const urls = new Map((linked?.id === cart.id ? linked.items : []).map(item => [`${item.type}:${item.id}:${item.sku}`, item.url]));
  const items = cart.items.map(item => ({ ...item, url: urls.get(`${item.type}:${item.id}:${item.sku}`) || item.url }));
  return <>{items.map((item, index) => <div key={index}>
    <p>{item.url ? <a className="checkout-productLink" href={item.url} target="_blank" rel="noopener noreferrer">{item.name} ↗</a> : item.name}</p>
    <small>{item.sku} · ID {item.id} · {item.type === "product" ? "Товар" : item.type} · {item.qty} од. · {money(item.price)} за одиницю · {money(item.sum)}</small>
  </div>)}</>;
}
