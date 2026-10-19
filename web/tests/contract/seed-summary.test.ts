/**
 * The neutral envelope keeps a compact summary of the turns that no longer fit in
 * `recent_turns` (docs/10 §3), so a context refresh (docs/08 §7.1) does not forget the
 * first figures. Verified with Gemini 2026-10-18: without it, after two refreshes the agent
 * no longer knew the first figure it gave.
 */
import { describe, expect, it } from "vitest";

const { olderTurnsSummary } = await import("../../src/voice/controller");

const turn = (q: string, a: string) => [
  { role: "user", text: q },
  { role: "agent", text: a },
];

describe("olderTurnsSummary", () => {
  it("summarizes only what is older than the recent window, oldest first, without the greeting", () => {
    const finals = [
      { role: "agent", text: "Hola, consulto el registro: 9.320 prestadores.", kind: "brief" },
      ...turn("¿Cuántas IPS hay en Antioquia?", "En Antioquia hay 837 prestadores."),
      ...turn("¿Y públicas?", "125 son públicas."),
      ...turn("¿Y en Caldas?", "En Caldas hay 193."),
    ];
    const s = olderTurnsSummary(finals, 2);
    expect(s).toMatch(/^Turnos anteriores/);
    expect(s).toContain("P: ¿Cuántas IPS hay en Antioquia? | R: En Antioquia hay 837 prestadores.");
    expect(s).toContain("125 son públicas");
    expect(s).not.toContain("Caldas"); // still in recent_turns
    expect(s).not.toContain("9.320"); // the greeting
  });

  it("uses what was heard and the user's correction, and stays small", () => {
    const finals = [
      { role: "user", text: "¿IPS en Melgar?", correction: { text: "¿IPS en Melgar, Tolima?" } },
      { role: "agent", text: "En Melgar hay 20 prestadores y además muchos otros datos", delivered_text: "En Melgar hay 20 prestadores" },
      ...Array.from({ length: 40 }, (_, i) => turn(`pregunta ${i} ${"x".repeat(80)}`, `respuesta ${i} ${"y".repeat(200)}`)).flat(),
    ];
    const s = olderTurnsSummary(finals, 8);
    expect(s).toContain("P: ¿IPS en Melgar, Tolima?");
    expect(s).toContain("R: En Melgar hay 20 prestadores |");
    expect(s.length).toBeLessThanOrEqual(1700);
  });

  it("is empty when everything fits in the recent window", () => {
    expect(olderTurnsSummary(turn("a", "b"), 8)).toBe("");
  });
});
