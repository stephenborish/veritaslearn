// jsdom environment shims required by the components under test (motion's
// useReducedMotion uses matchMedia; some UI calls scrollIntoView; navigation
// guards call window.confirm). None of these affect the persistence logic we test.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

if (!window.matchMedia) {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Default: confirm() returns true so "return to library" navigation never blocks.
window.confirm = () => true;

// jsdom has no layout; stub scroll APIs some handlers call.
(window as any).scrollTo = () => {};
if (!Element.prototype.scrollTo) {
  (Element.prototype as any).scrollTo = () => {};
}

afterEach(() => {
  cleanup();
});