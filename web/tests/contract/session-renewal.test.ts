/**
 * An expired anonymous session (401 SESSION_EXPIRED, docs/08 §3, R-28) is renewed
 * once and the same call is repeated, so the agent never hears "the source is
 * unavailable" for what was only an old token. No network: `fetch` is replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Seen {
  url: string;
  token: string | null;
}

let seen: Seen[] = [];
let tokens = 0;

function backend(toolStatuses: number[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const token = new Headers(init?.headers).get("X-Session-Token");
    seen.push({ url, token });
    if (url.endsWith("/sessions")) return new Response(JSON.stringify({ token: `tok-${++tokens}` }), { status: 201 });
    const status = toolStatuses.shift() ?? 200;
    if (status === 401) return new Response(JSON.stringify({ error: { code: "SESSION_EXPIRED" } }), { status });
    return new Response(JSON.stringify({ status: "ok", data: { value: 46 } }), { status });
  }) as typeof fetch;
}

async function loadApi() {
  vi.resetModules();
  vi.stubEnv("PUBLIC_API_URL", "https://example.test/api");
  return import("../../src/voice/api");
}

const call = { tool_call_id: "c1", name: "aggregate_ips", args: { metric: "provider_count" } } as const;
const ctx = { conversation_id: "conv", turn_id: "t1", state_version: 0 };

beforeEach(() => {
  seen = [];
  tokens = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sesión vencida", () => {
  it("un 401 pide un token nuevo y repite la misma llamada una vez", async () => {
    vi.stubGlobal("fetch", backend([401, 200]));
    const api = await loadApi();
    const env = await api.runTool(call, ctx);
    expect(env.status).toBe("ok");
    const tools = seen.filter((s) => s.url.includes("/tools/"));
    expect(tools.map((s) => s.token)).toEqual(["tok-1", "tok-2"]);
    expect(seen.filter((s) => s.url.endsWith("/sessions"))).toHaveLength(2);
  });

  it("si el token nuevo también es rechazado, no insiste más y la llamada no se cuelga", async () => {
    vi.stubGlobal("fetch", backend([401, 401, 200]));
    const api = await loadApi();
    const env = await api.runTool(call, ctx);
    expect(env.status).toBe("unavailable");
    expect(seen.filter((s) => s.url.includes("/tools/"))).toHaveLength(2);
  });
});
