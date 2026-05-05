import React, { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { MessageCircle, X } from "lucide-react";

export const NOTIF_POPUP_KEY = "nayade_notif_popup_disabled";
export const NOTIF_SOUND_KEY = "nayade_notif_sound_disabled";

function playBeep() {
  try {
    if (localStorage.getItem(NOTIF_SOUND_KEY) === "true") return;
    const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {}
}

export function WhatsAppNotification() {
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);
  const prevUnread = useRef<number | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();

  const { data: stats } = trpc.ghlInbox.getStats.useQuery(undefined, {
    refetchInterval: 15000,
  });

  // SSE: invalidar stats en tiempo real cuando llega un nuevo mensaje
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      try {
        es = new EventSource("/api/ghl/inbox/stream?token=nayade-ghl-stream");
        es.onmessage = (e) => {
          try {
            const payload = JSON.parse(e.data);
            if (payload?.type && payload.type !== "connected") {
              utils.ghlInbox.getStats.invalidate();
            }
          } catch {}
        };
        es.onerror = () => {
          es?.close();
          es = null;
          retryTimer = setTimeout(connect, 10000);
        };
      } catch {}
    }

    connect();
    return () => {
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    const current = stats?.conversations?.unread ?? 0;

    if (prevUnread.current === null) {
      prevUnread.current = current;
      if (current > 0 && localStorage.getItem(NOTIF_POPUP_KEY) !== "true") {
        const t = setTimeout(() => { setCount(current); setVisible(true); }, 2000);
        return () => clearTimeout(t);
      }
      return;
    }

    if (current > prevUnread.current) {
      prevUnread.current = current;
      if (localStorage.getItem(NOTIF_POPUP_KEY) !== "true") {
        setCount(current);
        setVisible(true);
        playBeep();
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => setVisible(false), 12000);
      }
    } else {
      prevUnread.current = current;
      setCount(current);
    }
  }, [stats?.conversations?.unread]);

  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); }, []);

  if (!visible || count === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[200] w-72 rounded-xl border border-emerald-500/40 bg-card shadow-2xl overflow-hidden"
      style={{ animation: "slide-up 0.25s ease-out" }}
    >
      <style>{`@keyframes slide-up{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20">
        <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
          <MessageCircle className="w-4 h-4" />
          WhatsApp GHL
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-foreground/40 hover:text-foreground/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-foreground/80">
          Tienes{" "}
          <span className="font-bold text-emerald-400">{count}</span>{" "}
          conversación{count !== 1 ? "es" : ""} sin leer
        </p>
        <Link
          href="/admin/atencion-comercial/whatsapp"
          onClick={() => setVisible(false)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
        >
          Abrir WhatsApp GHL →
        </Link>
      </div>
    </div>
  );
}
