import { describe, expect, it } from "vitest";
import {
  hasLoadedBefore,
  imageShouldFade,
  initialImageLoadState,
  reduceImageLoad,
  rememberLoaded,
  type ImageLoadState,
} from "./imageLoadState";

const A = "/api/v1/planning/a/screenshot";
const B = "/api/v1/website-references/b/screenshot?v=2";

describe("imageLoadState", () => {
  it("starts loading, and visible without a fade when the src is known to have loaded", () => {
    expect(initialImageLoadState(A)).toEqual({ src: A, phase: "loading" });
    expect(initialImageLoadState(A, true)).toEqual({ src: A, phase: "loaded-cached" });
  });

  it("shows an already-complete image at once, with no fade", () => {
    const s = reduceImageLoad(initialImageLoadState(A), { type: "probe", src: A, complete: true, naturalWidth: 1280 });
    expect(s.phase).toBe("loaded-cached");
    expect(imageShouldFade(s.phase)).toBe(false);
  });

  it("stays loading when the probe finds the image still in flight", () => {
    const start = initialImageLoadState(A);
    expect(reduceImageLoad(start, { type: "probe", src: A, complete: false, naturalWidth: 0 })).toBe(start);
  });

  it("fades in once on a load that arrives after mount", () => {
    const s = reduceImageLoad(initialImageLoadState(A), { type: "load", src: A });
    expect(s.phase).toBe("loaded-fade");
    expect(imageShouldFade(s.phase)).toBe(true);
  });

  it("does not replay: repeated load/probe events for the same src return the same state", () => {
    const faded = reduceImageLoad(initialImageLoadState(A), { type: "load", src: A });
    expect(reduceImageLoad(faded, { type: "load", src: A })).toBe(faded);
    expect(reduceImageLoad(faded, { type: "probe", src: A, complete: true, naturalWidth: 10 })).toBe(faded);

    const cached = reduceImageLoad(initialImageLoadState(A), { type: "probe", src: A, complete: true, naturalWidth: 10 });
    expect(reduceImageLoad(cached, { type: "load", src: A })).toBe(cached);
  });

  it("treats complete-with-no-pixels and the error event as a failure", () => {
    expect(reduceImageLoad(initialImageLoadState(A), { type: "probe", src: A, complete: true, naturalWidth: 0 }).phase).toBe("error");
    const failed = reduceImageLoad(initialImageLoadState(A), { type: "error", src: A });
    expect(failed.phase).toBe("error");
    // No retry loop: further failures are a no-op.
    expect(reduceImageLoad(failed, { type: "error", src: A })).toBe(failed);
    expect(reduceImageLoad(failed, { type: "probe", src: A, complete: true, naturalWidth: 0 })).toBe(failed);
  });

  it("lets a real load win over an early broken reading for the same src", () => {
    const failed = reduceImageLoad(initialImageLoadState(A), { type: "probe", src: A, complete: true, naturalWidth: 0 });
    expect(reduceImageLoad(failed, { type: "load", src: A }).phase).toBe("loaded-fade");
  });

  it("resets on a changed src, from any phase", () => {
    const phases: ImageLoadState[] = [
      { src: A, phase: "loaded-fade" },
      { src: A, phase: "loaded-cached" },
      { src: A, phase: "error" },
    ];
    for (const s of phases) {
      expect(reduceImageLoad(s, { type: "probe", src: B, complete: false, naturalWidth: 0 })).toEqual({ src: B, phase: "loading" });
      expect(reduceImageLoad(s, { type: "load", src: B })).toEqual({ src: B, phase: "loaded-fade" });
      expect(reduceImageLoad(s, { type: "error", src: B })).toEqual({ src: B, phase: "error" });
    }
  });

  it("treats a cache-busting param change as a new load", () => {
    const loaded = reduceImageLoad(initialImageLoadState(`${B}`), { type: "load", src: B });
    const next = `${B.replace("v=2", "v=3")}`;
    expect(reduceImageLoad(loaded, { type: "probe", src: next, complete: false, naturalWidth: 0 }).phase).toBe("loading");
  });

  it("starts a changed src visible when it has loaded before, and still fails honestly", () => {
    const s = reduceImageLoad({ src: A, phase: "loading" }, { type: "probe", src: B, complete: false, naturalWidth: 0 }, true);
    expect(s).toEqual({ src: B, phase: "loaded-cached" });
    expect(reduceImageLoad(s, { type: "load", src: B })).toBe(s);
    expect(reduceImageLoad(s, { type: "error", src: B }).phase).toBe("error");
  });

  it("remembers loaded sources, bounded, dropping the oldest", () => {
    const store = new Set<string>();
    rememberLoaded("a", store, 2);
    rememberLoaded("b", store, 2);
    rememberLoaded("a", store, 2);
    expect([...store]).toEqual(["a", "b"]);
    rememberLoaded("c", store, 2);
    expect(hasLoadedBefore("a", store)).toBe(false);
    expect(hasLoadedBefore("b", store)).toBe(true);
    expect(hasLoadedBefore("c", store)).toBe(true);
  });
});
