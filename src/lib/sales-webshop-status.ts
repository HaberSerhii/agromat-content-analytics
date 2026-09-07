export const NOVA_POSHTA_RETURN_STATUS = "Оформлено повернення НП";

export type WebshopStatusOrder = {
  id: number | string;
  status?: string | null;
  fulfillment?: {
    current?: { name?: string | null } | null;
    history?: Array<{ name?: string | null }>;
  } | null;
};

function normalizedStatus(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("uk") || "";
}

export function hasConfirmedNovaPoshtaReturn(
  order: WebshopStatusOrder,
  returnedWebshopIds: ReadonlySet<string>,
) {
  const history = order.fulfillment?.history || [];
  const wasSentByNovaPoshta = history.some((entry) => (
    normalizedStatus(entry.name).includes("відправлення нп")
  ));
  const wasReceived = history.some((entry) => (
    normalizedStatus(entry.name).includes("отримано")
  ));

  return wasSentByNovaPoshta
    && !wasReceived
    && returnedWebshopIds.has(String(order.id));
}

export function webshopFinalStatus(
  order: WebshopStatusOrder,
  returnedWebshopIds: ReadonlySet<string>,
) {
  if (hasConfirmedNovaPoshtaReturn(order, returnedWebshopIds)) {
    return NOVA_POSHTA_RETURN_STATUS;
  }
  return order.fulfillment?.current?.name?.trim() || order.status?.trim() || "unknown";
}
