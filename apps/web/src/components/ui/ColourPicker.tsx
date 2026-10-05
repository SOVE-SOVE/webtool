"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { hexToHsv, hsvToHex, parseHex, type Hex, type Hsv } from "@/lib/chartPalette";
import { HUE_MAX, clamp01, hsvFromHex, hueName, placePopover, stepHue, stepSv } from "@/lib/colourPicker";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
// White rim + dark hairline: the thumb stays visible on any colour.
const THUMB =
  "pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.55),0_1px_3px_rgb(0_0_0/0.35)]";
const RAINBOW = "linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%)";

/**
 * A swatch button that opens a colour picker in a popover: a
 * saturation/brightness square, a hue slider, a HEX field and
 * current-vs-new swatches. Any opaque RGB colour; no alpha. Custom-built
 * (no dependency, no native `<input type="color">`).
 *
 * `children` is the trigger's content (swatch + label). Every change
 * calls `onChange` straight away — there is nothing to confirm inside
 * the popover; the caller decides what a change means (a draft, here).
 *
 * Same non-modal popover behaviour as FilterPopover: opening moves focus
 * to the first control; Escape or "Done" closes and returns focus to the
 * trigger; a press outside, or Tab leaving it, closes it. The panel is in
 * the top layer (`popover="manual"`), placed against the trigger and
 * kept whole inside the viewport — covering the trigger if it must
 * (lib/colourPicker.placePopover).
 */
export function ColourPicker({
  label,
  value,
  onChange,
  className = "",
  children,
}: {
  /** What is being coloured, e.g. "Received" — names the popover. */
  label: string;
  value: Hex;
  onChange: (hex: Hex) => void;
  /** Classes for the trigger button. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        // Only a real move of focus to somewhere outside closes it (see FilterPopover).
        if (open && e.relatedTarget instanceof Node && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={className}
      >
        {children}
      </button>
      {open && <ColourPickerPanel id={panelId} label={label} value={value} onChange={onChange} onDone={close} triggerRef={triggerRef} />}
    </div>
  );
}

/** Mounted only while open, so "current" is the colour it opened with
 * and the hue it holds starts from that colour. */
function ColourPickerPanel({
  id,
  label,
  value,
  onChange,
  onDone,
  triggerRef,
}: {
  id: string;
  label: string;
  value: Hex;
  onChange: (hex: Hex) => void;
  onDone: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [initial] = useState(value);
  // Hue (and saturation) live here, not derived from `value`: a grey or
  // black has neither, and deriving them would snap the sliders to 0.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState<string>(value);
  const panelRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hexId = useId();
  const hexHelpId = useId();
  const hexInvalid = parseHex(hexText) === null;

  // Before paint, so the panel never flashes at the top layer's default
  // (centred) position; re-placed on resize/zoom and when anything
  // scrolls under the trigger.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    try {
      if (!panel.matches(":popover-open")) panel.showPopover?.();
    } catch {
      // No Popover API: the panel is still `fixed` and placed below.
    }

    function place() {
      if (!panel || !trigger) return;
      panel.style.maxHeight = "";
      const t = trigger.getBoundingClientRect();
      const placed = placePopover({
        anchor: { top: t.top, bottom: t.bottom, left: t.left },
        panel: { width: panel.offsetWidth, height: panel.offsetHeight },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      });
      panel.style.maxHeight = `${placed.maxHeight}px`;
      panel.style.top = `${placed.top}px`;
      panel.style.left = `${placed.left}px`;
    }
    // The panel's own scrolling doesn't move the trigger.
    function handleScroll(e: Event) {
      if (!(e.target instanceof Node && panel?.contains(e.target))) place();
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [triggerRef]);

  // Straight away rather than in a frame callback: those don't run in a
  // background tab, which would leave focus on the trigger.
  useEffect(() => {
    svRef.current?.focus({ preventScroll: true });
  }, []);

  function commit(next: Hsv) {
    const hex = hsvToHex(next);
    setHsv(next);
    setHexText(hex);
    onChange(hex);
  }

  function commitHex(hex: Hex, text: string = hex) {
    setHsv((prev) => hsvFromHex(hex, prev));
    setHexText(text);
    onChange(hex);
  }

  function svFromPointer(e: ReactPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    commit({ h: hsv.h, s: clamp01((e.clientX - r.left) / r.width), v: 1 - clamp01((e.clientY - r.top) / r.height) });
  }

  function hueFromPointer(e: ReactPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    commit({ ...hsv, h: Math.round(clamp01((e.clientX - r.left) / r.width) * HUE_MAX) });
  }

  // Follows the pointer 1:1 from the press, and keeps following outside
  // the control's bounds until release (pointer capture).
  function dragHandlers(update: (e: ReactPointerEvent<HTMLDivElement>) => void) {
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e);
      },
    };
  }

  function stepKey(e: KeyboardEvent, next: Hsv | null) {
    if (!next) return;
    e.preventDefault();
    commit(next);
  }

  const saturation = Math.round(hsv.s * 100);
  const brightness = Math.round(hsv.v * 100);
  const hue = Math.round(hsv.h);
  const pureHue = `hsl(${hue} 100% 50%)`;

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={`${label} colour`}
      tabIndex={-1}
      popover="manual"
      // `inset-auto m-0` undo the UA popover centring; the layout effect sets top/left/max-height.
      className="animate-rise-in fixed inset-auto z-50 m-0 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-3 text-fg shadow-xl outline-none"
    >
      <p className="text-xs font-medium text-fg">{label}</p>

      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={saturation}
        aria-valuetext={`Saturation ${saturation}%, brightness ${brightness}%`}
        aria-describedby={`${id}-sv-help`}
        {...dragHandlers(svFromPointer)}
        onKeyDown={(e) => stepKey(e, stepSv(hsv, e.key, e.shiftKey))}
        className={`relative mt-2 h-36 w-full cursor-crosshair touch-none rounded-md ${FOCUS_RING}`}
        style={{
          backgroundColor: pureHue,
          backgroundImage: "linear-gradient(to top, #000, rgb(0 0 0 / 0)), linear-gradient(to right, #fff, rgb(255 255 255 / 0))",
        }}
      >
        <span aria-hidden="true" className={THUMB} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }} />
      </div>
      <p id={`${id}-sv-help`} className="sr-only">
        Left and Right arrows change saturation, Up and Down change brightness. Hold Shift for larger steps.
      </p>

      {/* 44px-tall target around a slim track. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={HUE_MAX}
        aria-valuenow={hue}
        aria-valuetext={`${hue}°, ${hueName(hue)}`}
        {...dragHandlers(hueFromPointer)}
        onKeyDown={(e) => {
          const next = stepHue(hsv.h, e.key, e.shiftKey);
          stepKey(e, next === null ? null : { ...hsv, h: next });
        }}
        className={`relative mt-1 flex h-11 w-full cursor-pointer touch-none items-center rounded-md ${FOCUS_RING}`}
      >
        <span aria-hidden="true" className="block h-3.5 w-full rounded-full" style={{ backgroundImage: RAINBOW }} />
        <span aria-hidden="true" className={`${THUMB} top-1/2`} style={{ left: `${(hsv.h / HUE_MAX) * 100}%`, backgroundColor: pureHue }} />
      </div>

      <div className="mt-1 flex items-start gap-3">
        <div className="flex shrink-0 text-center text-[11px] leading-4 text-fg-muted">
          <button
            type="button"
            onClick={() => commitHex(initial)}
            disabled={value === initial}
            aria-label={`Current colour ${initial}. Go back to it`}
            title="Go back to the current colour"
            className={`rounded-md ${FOCUS_RING} disabled:cursor-default`}
          >
            <span aria-hidden="true" className="block h-9 w-11 rounded-l-md border border-r-0 border-border-strong" style={{ backgroundColor: initial }} />
            <span aria-hidden="true" className="mt-0.5 block">
              Current
            </span>
          </button>
          <div>
            <span aria-hidden="true" className="block h-9 w-11 rounded-r-md border border-border-strong" style={{ backgroundColor: value }} />
            <span className="mt-0.5 block">
              New<span className="sr-only"> colour {value}</span>
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <input
            id={hexId}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={9}
            aria-label="HEX colour"
            aria-invalid={hexInvalid}
            aria-describedby={hexHelpId}
            value={hexText}
            onChange={(e) => {
              const text = e.target.value;
              const hex = parseHex(text);
              // Invalid text changes nothing: the last valid colour stays.
              if (hex) commitHex(hex, text);
              else setHexText(text);
            }}
            onBlur={() => setHexText(value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setHexText(value);
            }}
            className={`input h-9 font-mono ${hexInvalid ? "border-danger hover:border-danger focus:border-danger focus:ring-danger" : ""}`}
          />
          <span aria-hidden="true" className="mt-0.5 block text-center text-[11px] leading-4 text-fg-muted">
            HEX
          </span>
        </div>
      </div>
      {/* Two lines reserved, so the error never resizes the panel. */}
      <p id={hexHelpId} aria-live="polite" className={`mt-1.5 min-h-8 text-xs leading-4 ${hexInvalid ? "text-danger" : "text-fg-muted"}`}>
        {hexInvalid ? `Not a HEX colour — use 3 or 6 digits, like #1a2b3c. Still using ${value}.` : "3 or 6 digits, with or without #."}
      </p>

      <div className="mt-2 flex justify-end border-t border-border pt-2.5">
        <button type="button" onClick={onDone} className="btn btn-secondary btn-sm">
          Done
        </button>
      </div>
    </div>
  );
}
