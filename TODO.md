# TODO

- [ ] Investigate history tiering causing revisited arguments in long discussions

  When the session exceeds ~20 turns, old-tier compression drops early context to single-line markers. Agents may lose track of points already settled and loop back to them. The T22 plateau test showed this is fine for circular debates but could hurt progressive discussions. Consider a "resolved topics" summary that survives compression.
