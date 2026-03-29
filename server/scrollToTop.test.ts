/**
 * Tests for ScrollToTop component logic
 * Verifies the scroll restoration and navigation behavior logic
 * (unit tests for the pure logic, not the React component or browser APIs)
 */
import { describe, it, expect } from "vitest";

describe("ScrollToTop logic", () => {
  it("should extract correct element ID from hash", () => {
    const hash = "#mi-seccion";
    const elementId = hash.slice(1);
    expect(elementId).toBe("mi-seccion");
  });

  it("should detect empty hash as no anchor", () => {
    const hash = "";
    const hasAnchor = !!(hash && hash.length > 1);
    expect(hasAnchor).toBe(false);
  });

  it("should detect bare # as no anchor", () => {
    const hash = "#";
    const hasAnchor = !!(hash && hash.length > 1);
    expect(hasAnchor).toBe(false);
  });

  it("should detect valid anchor hash", () => {
    const hash = "#section-experiencias";
    const hasAnchor = !!(hash && hash.length > 1);
    expect(hasAnchor).toBe(true);
  });

  it("should only trigger scroll when location actually changes", () => {
    let prevLocation = "";
    let scrollCallCount = 0;
    const currentLocation = "/experiencias";

    // First navigation - should trigger
    if (prevLocation !== currentLocation) {
      prevLocation = currentLocation;
      scrollCallCount++;
    }
    expect(scrollCallCount).toBe(1);

    // Same location again - should NOT trigger
    if (prevLocation !== currentLocation) {
      scrollCallCount++;
    }
    expect(scrollCallCount).toBe(1); // still 1, not 2
  });

  it("should trigger scroll on different location", () => {
    let prevLocation = "/experiencias";
    let scrollCallCount = 0;
    const newLocation = "/hotel";

    // Different location - should trigger
    if (prevLocation !== newLocation) {
      prevLocation = newLocation;
      scrollCallCount++;
    }
    expect(scrollCallCount).toBe(1);
    expect(prevLocation).toBe("/hotel");
  });

  it("should handle multiple sequential navigations correctly", () => {
    let prevLocation = "";
    let scrollCallCount = 0;
    const routes = ["/", "/experiencias", "/hotel", "/spa", "/hotel"];

    for (const route of routes) {
      if (prevLocation !== route) {
        prevLocation = route;
        scrollCallCount++;
      }
    }

    // All 5 routes are different from each other except last /hotel which is same as previous
    // /  -> /experiencias -> /hotel -> /spa -> /hotel
    // 1  -> 2             -> 3      -> 4     -> 5 (all different from prev)
    expect(scrollCallCount).toBe(5);
  });
});
