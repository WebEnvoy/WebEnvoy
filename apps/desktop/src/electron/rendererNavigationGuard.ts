import type { WebContents } from "electron";

import { isExpectedManualAuthenticationRendererUrl } from "./manualAuthenticationCompletion.js";

export function secureRendererNavigation(contents: WebContents, expectedRendererUrl: string) {
  contents.on("will-navigate", (event, targetUrl) => {
    if (!isExpectedManualAuthenticationRendererUrl(targetUrl, expectedRendererUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}
