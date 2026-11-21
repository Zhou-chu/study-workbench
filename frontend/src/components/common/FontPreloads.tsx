"use client";

import { preload } from "react-dom";

// Use the resource-hint API, not literal links: Next can serialize the latter
// both as RSC hints and elements. Only the three Latin subsets are preloaded.
export function FontPreloads() {
  preload("/fonts/recovered-6219bc4bfdfc5d9b.woff2", {
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  });
  preload("/fonts/recovered-4fd48b2c1ab27220.woff2", {
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  });
  preload("/fonts/recovered-2b193a4f0fef3fc4.woff2", {
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  });
  return null;
}
