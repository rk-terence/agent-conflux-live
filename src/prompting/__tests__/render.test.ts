import { describe, it, expect } from "vitest";
import { render } from "../render.js";

describe("render", () => {
  it("replaces all placeholders", () => {
    expect(render("Hello {{name}}, topic: {{topic}}", { name: "A", topic: "B" }))
      .toBe("Hello A, topic: B");
  });

  it("throws on missing variable", () => {
    expect(() => render("{{missing}}", {})).toThrow("Missing template variable: {{missing}}");
  });

  it("handles template with no placeholders", () => {
    expect(render("no slots here", {})).toBe("no slots here");
  });

  it("replaces multiple occurrences of same placeholder", () => {
    expect(render("{{x}} and {{x}}", { x: "ok" })).toBe("ok and ok");
  });
});
