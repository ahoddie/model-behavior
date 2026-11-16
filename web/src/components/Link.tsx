"use client";
// The site's link. Every link prefetches the destination's prebuilt shell when it scrolls into view (the Next default).
// Once the reader points at, focuses or touches one, it also prefetches that exact page, so the click has nothing to wait for.
// Doing that for every visible link would cost a server render per link; doing it on intent costs one.
import NextLink from "next/link";
import { useState, type ComponentProps } from "react";

export default function Link({ prefetch, onPointerEnter, onFocus, onTouchStart, ...rest }: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false);
  return (
    <NextLink {...rest} prefetch={prefetch ?? (intent ? true : "auto")}
      onPointerEnter={(e) => { setIntent(true); onPointerEnter?.(e); }}
      onFocus={(e) => { setIntent(true); onFocus?.(e); }}
      onTouchStart={(e) => { setIntent(true); onTouchStart?.(e); }} />
  );
}
