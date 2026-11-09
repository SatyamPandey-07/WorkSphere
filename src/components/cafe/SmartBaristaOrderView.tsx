"use client";

import React, { useState, useEffect } from "react";
import {
  Coffee,
  Sparkles,
  Clock,
  Flame,
  Zap,
  CheckCircle2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
  Check,
  QrCode,
  ChevronRight,
  X,
} from "lucide-react";
import {
  MenuItem,
  SAMPLE_CAFE_MENU,
  DietaryTag,
  OrderItemInput,
  CafeOrder,
  SmartCafeEngine,
} from "@/lib/cafe/smartCafeEngine";
import { FocusTrap } from "@/components/ui/FocusTrap";
import { usePrepCountdown } from "@/hooks/usePrepCountdown";
import { formatReadyIn } from "@/lib/cafe/prepTime";

const ALL_DIETARY_TAGS: Array<{
  tag: DietaryTag;
  label: string;
  icon: string;
}> = [
  { tag: "vegan", label: "Vegan", icon: "🌱" },
  { tag: "gluten_free", label: "Gluten-Free", icon: "🌾" },
  { tag: "dairy_free", label: "Dairy-Free", icon: "🥛" },
  { tag: "keto", label: "Keto / Low-Carb", icon: "🥑" },
  { tag: "nut_free", label: "Nut-Free", icon: "🥜" },
  { tag: "low_sugar", label: "Low Sugar", icon: "🍬" },
  { tag: "organic", label: "100% Organic", icon: "✨" },
];

export default function SmartBaristaOrderView() {
  const [selectedTags, setSelectedTags] = useState<DietaryTag[]>([]);
  const [activeCategory] = useState<string>("all");
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string[]>
  >({});
  const [quantity, setQuantity] = useState(1);

  const [cart, setCart] = useState<OrderItemInput[]>([]);
  const [deskNumber, setDeskNumber] = useState("Desk #14B");
  const [customerName, setCustomerName] = useState("Alex Chen");
  const [activeOrder, setActiveOrder] = useState<CafeOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Filter items
  const filteredMenu = SmartCafeEngine.filterMenu(
    SAMPLE_CAFE_MENU,
    selectedTags,
    [],
    activeCategory === "all"
      ? undefined
      : (activeCategory as MenuItem["category"]),
  );

  // Toggle dietary tag
  const toggleTag = (tag: DietaryTag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  // Open item customizer
  const openCustomizer = (item: MenuItem) => {
    setCustomizingItem(item);
    setQuantity(1);
    const defaults: Record<string, string[]> = {};
    item.customizationGroups.forEach((g) => {
      if (g.options.length > 0) {
        defaults[g.id] = [g.options[0].id];
      }
    });
    setSelectedOptions(defaults);
  };

  // Handle option select
  const selectOption = (
    groupId: string,
    optionId: string,
    maxSelectable: number,
  ) => {
    setSelectedOptions((prev) => {
      const current = prev[groupId] || [];
      if (maxSelectable === 1) {
        return { ...prev, [groupId]: [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (current.length < maxSelectable) {
        return { ...prev, [groupId]: [...current, optionId] };
      }
      return prev;
    });
  };

  // Calculate price of item being customized
  const calculateCustomizedPrice = () => {
    if (!customizingItem) return 0;
    let price = customizingItem.basePrice;
    Object.entries(selectedOptions).forEach(([groupId, optIds]) => {
      const group = customizingItem.customizationGroups.find(
        (g) => g.id === groupId,
      );
      if (!group) return;
      optIds.forEach((id) => {
        const opt = group.options.find((o) => o.id === id);
        if (opt) price += opt.priceDelta;
      });
    });
    return price * Math.max(1, quantity);
  };

  // Add to cart
  const addToCart = () => {
    if (!customizingItem || quantity < 1) return;
    const safeQty = Math.max(1, Math.floor(quantity));
    const customizations = Object.entries(selectedOptions).map(
      ([groupId, selectedOptionIds]) => ({
        groupId,
        selectedOptionIds,
      }),
    );

    const orderItem: OrderItemInput = {
      menuItemId: customizingItem.id,
      quantity: safeQty,
      customizations,
    };

    setCart((prev) => [...prev, orderItem]);
    setCustomizingItem(null);
  };

  const updateCartItemQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((_, i) => i !== index));
    } else {
      setCart((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, quantity: newQty } : item,
        ),
      );
    }
  };

  // Submit mobile pre-order
  const submitOrder = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/cafe/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart,
          customerName,
          deskNumber,
          venueName: "SoMa Focus Hub & Artisan Roastery",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveOrder(data.order);
        setCart([]);
      }
    } catch (err) {
      console.error("Order submission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmCancelOrder = async () => {
    if (!activeOrder || activeOrder.status !== "received" || isCancelling)
      return;

    setIsCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(
        `/api/cafe/orders?orderId=${encodeURIComponent(activeOrder.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.order) {
          setActiveOrder(data.order);
        }
        throw new Error(data.error || "The order could not be cancelled.");
      }

      setActiveOrder(null);
      setIsCancelDialogOpen(false);
    } catch (err) {
      console.error("Order cancellation failed:", err);
      setCancelError(
        err instanceof Error
          ? err.message
          : "The order could not be cancelled.",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // Live progress simulation for active order
  useEffect(() => {
    if (!activeOrder || activeOrder.status === "ready_for_pickup") return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= activeOrder.estimatedReadyTime) {
        setActiveOrder((prev) =>
          prev ? { ...prev, status: "ready_for_pickup" } : null,
        );
      } else if (
        now - activeOrder.createdAt > 15000 &&
        activeOrder.status === "received"
      ) {
        setActiveOrder((prev) =>
          prev ? { ...prev, status: "brewing" } : null,
        );
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeOrder]);

  const isPrepInProgress =
    activeOrder?.status === "received" || activeOrder?.status === "brewing";
  const prepMinutesLeft = usePrepCountdown(
    activeOrder?.estimatedReadyTime,
    isPrepInProgress,
  );
  const cartCalculation =
    cart.length > 0
      ? SmartCafeEngine.calculateOrderDetails(cart, SAMPLE_CAFE_MENU, 3)
      : null;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 text-slate-100">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shadow-sm">
            <Coffee className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Smart Cafe & Barista Pre-Ordering
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                DESK DELIVERY & PICKUP
              </span>
            </h2>
            <p className="text-sm text-slate-400">
              Zero-friction ordering with instant allergen filters, custom
              brews, and queue-time prediction
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Live Barista Load</div>
            <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5 justify-end">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              ~4-6 min avg. wait
            </div>
          </div>
        </div>
      </div>

      {/* Active Order Live Ticket View */}
      {activeOrder && (
        <div className="p-6 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-900/90 backdrop-blur-md rounded-2xl border border-amber-500/40 shadow-xl space-y-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {activeOrder.status === "received"
                    ? "Order Received"
                    : activeOrder.status === "brewing"
                      ? "☕ Barista is Brewing"
                      : "🎉 Ready for Pickup!"}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ID: {activeOrder.id}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">
                {activeOrder.venueName} — {activeOrder.deskNumber}
              </h3>
              {prepMinutesLeft !== null && (
                <p
                  role="timer"
                  className="flex items-center gap-1.5 text-sm font-semibold text-amber-300"
                >
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  {formatReadyIn(prepMinutesLeft)}
                </p>
              )}
            </div>

            <div className="flex items-center gap-4 bg-slate-800/80 p-3 rounded-xl border border-slate-700">
              <div className="text-center px-2">
                <div className="text-[10px] text-slate-400 uppercase font-mono">
                  Pickup Pass
                </div>
                <div className="text-2xl font-black font-mono text-amber-400 tracking-wider">
                  {activeOrder.pickupCode}
                </div>
              </div>
              <div className="p-2 bg-white rounded-lg text-slate-900">
                <QrCode className="w-8 h-8" />
              </div>
            </div>
          </div>

          {/* Progress Timeline */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1 text-amber-300 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Order Queued
              </span>
              <span
                className={`flex items-center gap-1 ${
                  activeOrder.status === "brewing" ||
                  activeOrder.status === "ready_for_pickup"
                    ? "text-amber-300 font-semibold"
                    : ""
                }`}
              >
                <Coffee className="w-3.5 h-3.5" /> Grinding & Steaming
              </span>
              <span
                className={`flex items-center gap-1 ${
                  activeOrder.status === "ready_for_pickup"
                    ? "text-emerald-400 font-bold"
                    : ""
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" /> Ready at Counter
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full rounded-full transition-all duration-1000"
                style={{
                  width:
                    activeOrder.status === "received"
                      ? "33%"
                      : activeOrder.status === "brewing"
                        ? "70%"
                        : "100%",
                }}
              />
            </div>
          </div>

          {/* Ordered items details */}
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <span className="text-slate-400">Items:</span>
              <div className="font-semibold text-slate-200">
                {activeOrder.items.map((it, idx) => (
                  <span key={idx}>
                    {it.quantity}x {it.item.name}
                    {it.customizations.length > 0 &&
                      ` (${it.customizations.flatMap((c) => c.optionNames).join(", ")})`}
                    {idx < activeOrder.items.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right font-mono text-sm font-bold text-white">
              Total: ${activeOrder.total.toFixed(2)}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setCancelError(null);
                setIsCancelDialogOpen(true);
              }}
              disabled={activeOrder.status !== "received" || isCancelling}
              className="px-4 py-2 rounded-xl border border-rose-500/40 text-rose-200 text-xs font-bold hover:bg-rose-500/10 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel Order
            </button>
          </div>
        </div>
      )}

      {isCancelDialogOpen && activeOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <FocusTrap
            className="w-full max-w-md space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            aria-labelledby="cancel-order-title"
            aria-describedby="cancel-order-description"
            initialFocusSelector="[data-initial-focus]"
            onEscape={() => {
              if (!isCancelling) {
                setIsCancelDialogOpen(false);
                setCancelError(null);
              }
            }}
          >
            <h2
              id="cancel-order-title"
              className="text-lg font-bold text-white"
            >
              Confirm order cancellation
            </h2>
            <p id="cancel-order-description" className="text-sm text-slate-300">
              Are you sure you want to cancel your barista order?
            </p>
            {cancelError && (
              <p role="alert" className="text-sm text-rose-300">
                {cancelError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                data-initial-focus
                onClick={() => {
                  setIsCancelDialogOpen(false);
                  setCancelError(null);
                }}
                disabled={isCancelling}
                className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={confirmCancelOrder}
                disabled={activeOrder.status !== "received" || isCancelling}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancelling ? "Cancelling..." : "Yes, Cancel"}
              </button>
            </div>
          </FocusTrap>
        </div>
      )}

      {/* Dietary Filter Bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Dietary & Allergen Preferences
          </span>
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              className="text-xs text-amber-400 hover:text-amber-300 font-semibold"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {ALL_DIETARY_TAGS.map(({ tag, label, icon }) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border ${
                  isSelected
                    ? "bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm"
                    : "bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
                {isSelected && (
                  <Check className="w-3 h-3 ml-0.5 text-amber-300" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Layout: Menu + Cart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Menu Grid (Left 2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredMenu.map((item) => (
              <div
                key={item.id}
                className="p-5 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4 shadow-sm"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {item.category.replace("_", " ")}
                    </span>
                    <span className="text-sm font-bold font-mono text-amber-400">
                      ${item.basePrice.toFixed(2)}
                    </span>
                  </div>

                  <h3 className="font-bold text-white text-base leading-snug">
                    {item.name}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-800">
                  {/* Dietary & Macro Pills */}
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 flex items-center gap-1">
                      <Flame className="w-3 h-3 text-orange-400" />{" "}
                      {item.baseCalories} kcal
                    </span>
                    {item.caffeineMg > 0 && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-yellow-400" />{" "}
                        {item.caffeineMg}mg caffeine
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-cyan-400" /> ~
                      {item.prepTimeMinutes}m
                    </span>
                  </div>

                  <button
                    onClick={() => openCustomizer(item)}
                    className="w-full py-2 bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow"
                  >
                    Customize & Add <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cart & Desk Checkout (Right Col) */}
        <div className="space-y-6 lg:col-span-1">
          <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base text-white">
                  Your Barista Order
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {cart.length} items
              </span>
            </div>

            {/* Desk Delivery Info */}
            <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Your Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">
                  Desk / Zone Location
                </label>
                <input
                  type="text"
                  value={deskNumber}
                  onChange={(e) => setDeskNumber(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Cart Items List */}
            {cart.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Cart is empty. Select a drink or bite above to customize.
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                {cartCalculation?.calculatedItems.map((cartItem, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/40 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200">
                        {cartItem.quantity}x {cartItem.item.name}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {cartItem.customizations
                          .flatMap((c) => c.optionNames)
                          .join(", ") || "Standard"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                        <button
                          onClick={() =>
                            updateCartItemQuantity(idx, cartItem.quantity - 1)
                          }
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                          title="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono px-1 font-bold text-white text-xs">
                          {cartItem.quantity}
                        </span>
                        <button
                          onClick={() =>
                            updateCartItemQuantity(idx, cartItem.quantity + 1)
                          }
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                          title="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="font-mono font-bold text-amber-300 min-w-[50px] text-right">
                        ${cartItem.itemTotalPrice.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Price Breakdown */}
                {cartCalculation && (
                  <div className="space-y-1.5 pt-3 border-t border-slate-800 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Subtotal:</span>
                      <span className="font-mono text-slate-200">
                        ${cartCalculation.subtotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Tax (8.75%):</span>
                      <span className="font-mono text-slate-200">
                        ${cartCalculation.tax.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Est. Prep Time:</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        ~{cartCalculation.estimatedPrepMinutes} mins
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-700">
                      <span>Total:</span>
                      <span className="font-mono text-amber-400">
                        ${cartCalculation.total.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={submitOrder}
                  disabled={
                    isSubmitting ||
                    cart.length === 0 ||
                    cart.reduce((sum, i) => sum + i.quantity, 0) === 0
                  }
                  className={`w-full py-3 font-bold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 ${
                    isSubmitting ||
                    cart.length === 0 ||
                    cart.reduce((sum, i) => sum + i.quantity, 0) === 0
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                      : "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white"
                  }`}
                >
                  {isSubmitting ? (
                    "Sending to Barista..."
                  ) : (
                    <>
                      Place Pre-Order <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Item Customization Modal */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {customizingItem.name}
                </h3>
                <p className="text-xs text-slate-400">
                  {customizingItem.description}
                </p>
              </div>
              <button
                onClick={() => setCustomizingItem(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customization Options */}
            <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
              {customizingItem.customizationGroups.map((group) => (
                <div key={group.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span>{group.name}</span>
                    <span className="text-[10px] text-slate-500">
                      {group.required
                        ? "Required"
                        : `Max ${group.maxSelectable}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.options.map((opt) => {
                      const isSelected = (
                        selectedOptions[group.id] || []
                      ).includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          onClick={() =>
                            selectOption(group.id, opt.id, group.maxSelectable)
                          }
                          className={`p-2.5 rounded-xl border text-left text-xs transition-all flex items-center justify-between ${
                            isSelected
                              ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                              : "bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-600"
                          }`}
                        >
                          <span>{opt.name}</span>
                          {opt.priceDelta > 0 && (
                            <span className="font-mono text-slate-400">
                              +${opt.priceDelta.toFixed(2)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Quantity Selector */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-semibold">
                  Quantity
                </span>
                <div className="flex items-center gap-3 bg-slate-800 p-1 rounded-xl border border-slate-700">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    className="p-1 rounded-lg hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Decrease quantity"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-mono font-bold text-sm px-2 text-white">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="p-1 rounded-lg hover:bg-slate-700 text-slate-300"
                    title="Increase quantity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Add button */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="font-mono text-lg font-black text-amber-400">
                ${calculateCustomizedPrice().toFixed(2)}
              </div>
              <button
                onClick={addToCart}
                disabled={quantity < 1}
                className={`px-5 py-2.5 font-bold text-xs rounded-xl transition-all shadow ${
                  quantity < 1
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                    : "bg-amber-600 hover:bg-amber-500 text-white"
                }`}
              >
                {quantity < 1 ? "Select Quantity" : "Add to Cart"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
