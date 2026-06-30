"use client";

import { useEffect, useState } from "react";

/**
 * True when the viewport is at or below `breakpoint` (default 640px / Tailwind
 * `sm`). SSR-safe: starts false, resolves on mount, and tracks resizes.
 */
export function useIsMobile(breakpoint = 640): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);

  return mobile;
}
