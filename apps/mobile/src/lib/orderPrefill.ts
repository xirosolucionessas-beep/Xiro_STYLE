import type { Item, ProductOrderDto } from '@xiro/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CartLine } from './sale';

/**
 * Entregar un pedido de la página pública = registrar su venta (Fase 1 del plan). "Nueva venta" abierta con `?orderId=…` carga el
 * pedido y precarga el cliente y los productos (cantidades y precios del pedido: lo que se le prometió al cliente). Al guardar, la
 * venta lleva `productOrderId` y el servidor marca el pedido "Entregado" en la MISMA transacción que descuenta el inventario.
 * Mismo hook en la web (sale/new.web.tsx) y en Android/iOS (sale/new.tsx).
 */
export function useOrderPrefill(
  orderId: string | undefined,
  /** `discount`: lo que el código de descuento del pedido ya le prometió al cliente (Fase 4); 0 sin código. */
  apply: (prefill: { client: { id: string; name: string; phone: string | null }; lines: CartLine[]; discount: number }) => void,
  nextKey: () => string,
  /** Ajustar el precio de una venta exige el permiso del catálogo: sin él, se cobra el precio actual del catálogo (el servidor rechazaría otro). */
  canOverridePrice: boolean,
): { order: ProductOrderDto | null; loading: boolean; error: unknown; dismiss: () => void } {
  const [order, setOrder] = useState<ProductOrderDto | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [error, setError] = useState<unknown>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const keyRef = useRef(nextKey);
  keyRef.current = nextKey;
  const overrideRef = useRef(canOverridePrice);
  overrideRef.current = canOverridePrice;

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const loaded = await api.order(orderId);
      // Existencias ACTUALES del catálogo (para avisar si ya no alcanza). Se cobra el precio del pedido si quien entrega puede
      // ajustar precios; si no, el del catálogo.
      const catalog = await Promise.all(loaded.items.map((line) => (line.itemId ? api.item(line.itemId).catch(() => null) : Promise.resolve(null))));
      const byId = new Map(catalog.filter((item): item is Item => item !== null).map((item) => [item.id, item]));
      const lines: CartLine[] = loaded.items.map((line) => {
        const item = line.itemId ? byId.get(line.itemId) : undefined;
        return item
          ? { key: keyRef.current(), kind: 'product', itemId: item.id, name: item.name, unitPrice: overrideRef.current ? line.unitPrice : item.price, catalogPrice: item.price, quantity: line.quantity, employeeId: null, saveToCatalog: false, stock: item.stock }
          : // El producto se borró del catálogo después del pedido: se cobra como línea a mano, con su nombre y precio.
            { key: keyRef.current(), kind: 'product', itemId: null, name: line.name, unitPrice: line.unitPrice, catalogPrice: null, quantity: line.quantity, employeeId: null, saveToCatalog: false, stock: null };
      });
      if (cancelled) return;
      setOrder(loaded);
      applyRef.current({ client: { id: loaded.clientId, name: loaded.clientName, phone: loaded.customerPhone }, lines, discount: loaded.discount?.amount ?? 0 });
    })()
      .catch((e: unknown) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return { order, loading, error, dismiss: () => setOrder(null) };
}
