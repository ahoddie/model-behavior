"use client";
// The site's link. A link in view prefetches its destination's prebuilt shell (the Next default). Once the reader points at,
// focuses or touches it, the router also fetches that exact page, so the click swaps it in with no loading state and no
// request. Doing that for every visible link would cost a server render per link; doing it on intent costs one.
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import type { ComponentProps } from "react";

export default function Link({ onMouseEnter, onFocus, onTouchStart, ...rest }: ComponentProps<typeof NextLink>) {
  const router = useRouter();
  const intent = () => { if (typeof rest.href === "string" && rest.href.startsWith("/")) router.prefetch(rest.href, { kind: PrefetchKind.FULL }); };
  return (
    <NextLink {...rest}
      onMouseEnter={(e) => { intent(); onMouseEnter?.(e); }}
      onFocus={(e) => { intent(); onFocus?.(e); }}
      onTouchStart={(e) => { intent(); onTouchStart?.(e); }} />
  );
}
