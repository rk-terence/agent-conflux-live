import { describe, it, expect } from "vitest";
import { composeUserPrompt } from "../compose.js";

describe("composeUserPrompt", () => {
  it("combines projected history and turn directive with blank line separator", () => {
    const result = composeUserPrompt({
      projectedHistory: "- [0.0s] 讨论开始\n- [1.0s] **Claude**：\n  > 你好。",
      turnDirective: "---\n你要发言吗？",
    });
    expect(result).toBe(
      "- [0.0s] 讨论开始\n- [1.0s] **Claude**：\n  > 你好。\n\n---\n你要发言吗？",
    );
  });

  it("returns only turn directive when projected history is empty", () => {
    const result = composeUserPrompt({
      projectedHistory: "",
      turnDirective: "---\n你要发言吗？",
    });
    expect(result).toBe("---\n你要发言吗？");
  });
});
