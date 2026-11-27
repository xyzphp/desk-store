import type { MouseEvent } from 'react';

/** Keep browser-native modified clicks while routing ordinary clicks inside the React reader. */
export function followPublicArticleRoute(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  navigate: (href: string) => void,
) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}

/**
 * Write a reader route into the iframe history. The reader is a srcdoc document (URL about:srcdoc), so browsers
 * reject rewriting it to a site path with a SecurityError. That is not an invalid route: return false and let the
 * caller keep routing in component state only.
 */
export function writePublicArticleHistory(frameWindow: Window, href: string, replace = false) {
  try {
    if (replace) frameWindow.history.replaceState(null, '', href);
    else frameWindow.history.pushState(null, '', href);
    return true;
  } catch {
    return false;
  }
}
