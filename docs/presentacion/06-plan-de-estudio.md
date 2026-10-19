# 06 · Plan de estudio

Objetivo: entender el proyecto al derecho y al revés, explicarlo sin leer y defenderlo ante
preguntas. Unas **12–14 horas** repartidas en 4 bloques. Si tienes menos tiempo, haz los bloques 1, 2
y la autoevaluación (≈ 6 h).

---

## Bloque 1 · El mapa (≈ 3 h)

| Orden | Qué | Tiempo | Para qué |
|---|---|---|---|
| 1 | [01-el-proyecto-completo.md](01-el-proyecto-completo.md) §1–§5 | 45 min | Qué es, cronología, arquitectura, por qué, un turno de punta a punta |
| 2 | [02b-glosario.md](02b-glosario.md) secciones A, B, C | 45 min | Que ningún término te frene |
| 3 | `docs/07-reto-01-especificacion.md` §1, §4, §7 (tabla A-xx) y §8 | 30 min | Qué pedía el reto y cómo se aceptaba |
| 4 | `docs/00-contexto-y-decisiones.md` §5 (tabla D-xx) | 30 min | Las decisiones con su motivo |
| 5 | `CHANGELOG.md` de abajo arriba (0.1.0 → Unreleased) | 30 min | La historia: qué se intentó, qué falló, qué se corrigió |

**Ejercicio 1 (20 min):** dibuja la arquitectura **de memoria** en un papel: navegador (MicTap,
VoiceEngine, controller, store, PcmPlayer, avatar), los dos motores, Cartesia, el backend con sus
endpoints, datos.gov.co, el analista. Compáralo con `01` §3.1 y corrige.

## Bloque 2 · Cómo funciona por dentro (≈ 4 h)

| Orden | Qué | Tiempo |
|---|---|---|
| 1 | [02-como-se-hizo-cada-cosa.md](02-como-se-hizo-cada-cosa.md) completo | 90 min |
| 2 | Código, leyendo solo los comentarios de cabecera: `web/src/voice/types.ts`, `realtime-base.ts` (constantes de la regla de 1 s), `transcript-filter.ts`, `src/services/ips/verify.py`, `for_model.py`, `src/services/analyst/graph.py`, `nodes/fuse.py`, `config/style_policy.yaml`, `config/domains/reto01_ips.yaml` | 60 min |
| 3 | Avatar: cabeceras de `web/src/avatar/slime.ts`, `lipsync.ts`, `expression.ts`, `human.ts`, `web/public/avatars/LICENSE.md` | 30 min |
| 4 | `docs/08` §6 (interrupciones) y §15.1 (diseños de voz clonada); `docs/10` §6 (afecto) | 40 min |

**Ejercicio 2 — el flujo de una pregunta (30 min, en voz alta, con cronómetro):** explica qué pasa
desde que alguien dice «¿Cuántas IPS públicas hay en Antioquia?» hasta que oye la respuesta, en
**menos de 3 minutos**, nombrando: sesión, consentimiento, credencial efímera, WebSocket, VAD,
transcripción y filtro, muletilla, `tool_call`, `POST /tools`, léxico, SoQL, sobre de evidencia,
`for_model`, respuesta, voz (motor o clonada), lip-sync, análisis de afecto en paralelo, verificador.
Grábate y escucha.

**Ejercicio 3 — la interrupción (10 min):** explica la regla de 1 s en OpenAI y en Gemini, y por qué
en Gemini hay que reenviar el audio.

## Bloque 3 · Defender (≈ 3 h)

| Orden | Qué | Tiempo |
|---|---|---|
| 1 | [05-preguntas-probables.md](05-preguntas-probables.md): lee todas; ensaya **en voz alta** las ⚠ | 90 min |
| 2 | [03-investigacion-costos-y-estado-del-arte.md](03-investigacion-costos-y-estado-del-arte.md) (lo escribe otro agente): costos, ruido, reconocimiento, estado del arte | 60 min |
| 3 | `docs/anexos/eval-grounding-2026-10-09.md` (tasas y 3 casos), `bench-latencia` (resumen), `concurrencia` (tabla) | 30 min |

**Ejercicio 4 — justificar 5 decisiones (30 min):** para cada una, en 3 frases: qué se decidió, qué
se descartó y por qué, qué beneficio da.
1. Audio directo navegador ⇄ proveedor con credencial efímera (D-11, R-28)
2. Herramientas tipadas en vez de text-to-SQL (D-13)
3. Backend sin estado ni base de datos (D-18, D-23)
4. Fusión determinista de afecto y estilo en YAML (D-16)
5. Slime procedural como personaje por defecto (fork, `slime.ts`)

**Ejercicio 5 — herramienta vs MCP (5 min):** explícalo en 30 segundos sin la palabra «protocolo»
y luego con ella.

**Ejercicio 6 — honestidad (10 min):** di de memoria tres cosas que **no** están verificadas
(A-21 voz humana, eco con parlantes reales, p95 ≤ 4 s no cumplido; ver `07`).

## Bloque 4 · Ensayo (≈ 2–3 h)

| Orden | Qué | Tiempo |
|---|---|---|
| 1 | [04-guion-presentacion-20-10.md](04-guion-presentacion-20-10.md): monta las diapositivas sobre tu plantilla | 60 min |
| 2 | Ensayo 1 cronometrado (20 + 10), solo | 35 min |
| 3 | Ajustar lo que pase de tiempo | 15 min |
| 4 | Ensayo 2 con alguien que te haga 5 preguntas del `05` al azar | 45 min |
| 5 | Ensayo de la demo con fallos provocados: desconecta la red, cambia de motor, usa modo texto | 20 min |

---

## Lo que debes saber de memoria

**Cifras (con su matiz):**
- 9.320 prestadores · 10.921 códigos de sede · 41.427 filas · 97.036 camas · corte 5-nov-2022.
- 9 herramientas · 5 nodos del analista · 2 motores · 9 endpoints.
- Latencia p50 3,9 s (OpenAI) / 4,2 s (Gemini), antes 9,0 / 13,4; p95 4,7 / 6,9 → meta 4,0 **no cumplida**.
- 0 alucinaciones en 20 casos (OpenAI, prompt v2); 5/5 cifras; 10/10 rechazos.
- Emociones: 39 frases; Gemini 32 → 36; OpenAI 28 → 37; control 10/10. Voz: solo sintética.
- 8 evaluadores simultáneos sin fugas; Cartesia 3 simultáneas.
- Regla de 1 s; volumen al 30 %; Gemini 5 de 6.
- Cartesia 321 ms en caliente.
- Pruebas: 413 front (vitest) · 166/167 backend (pytest) · 70 navegador (Playwright).

**Frases clave (una por componente):** las «Qué decir en 1 frase» de `02`.

**Nombres y versiones:** `gpt-realtime-2.1`, `gemini-3.8-live`, `sonic-3.6`, `gemini-3.5-flash-lite`,
`gpt-5.4-mini`, prompt `reto01-ips-v10`, `affect-v2`, contrato de voz `2026-10-09.2`.

**Qué es propio y qué es librería en el avatar:** slime, gato y orbe propios (three.js es la
librería); humano = modelo VRoid `AvatarSample_C` + `@pixiv/three-vrm`, animación propia; lip-sync
propio con `AnalyserNode`; recorrido de ayuda propio (no driver.js).

---

## Lecturas recomendadas

- **Del repo (prioridad):** `docs/08` §6 y §15, `docs/09` §3–§5, `docs/10` §5–§6, `docs/13`.
- **Investigación de este paquete:** [03-investigacion-costos-y-estado-del-arte.md](03-investigacion-costos-y-estado-del-arte.md).
- **Diseño de IA humano-céntrica** (base del indicador de ánimo): Microsoft *Guidelines for Human-AI
  Interaction* (las 18 pautas HAX); Google *People + AI Guidebook* (PAIR), capítulo de explicabilidad y
  confianza; WCAG 2.2, criterio 1.4.1.
- **Regulación:** AI Act de la UE, artículos 5.1.f y 50; Ley 1581 de 2012 (Colombia).
- **Conceptos:** computación afectiva (R. Picard); emociones básicas (P. Ekman); toma de turnos en
  conversación; *uncanny valley* (M. Mori).
- **Documentación técnica:** OpenAI Realtime API; Gemini Live API (`activityHandling`,
  `turnComplete`); Cartesia TTS WebSocket; MCP (modelcontextprotocol.io); three.js y three-vrm;
  View Transitions API.

---

## Autoevaluación final

Responde sin mirar. Si fallas más de 3, repite el bloque correspondiente.

1. ¿Por qué el audio no pasa por el backend? Da dos razones técnicas y un beneficio.
2. ¿Qué es una credencial efímera y en qué se diferencia la de OpenAI de la de Gemini?
3. ¿Qué devuelve una herramienta además de los datos? ¿Qué es `for_model` y por qué existe?
4. ¿Qué no detecta el verificador de cifras?
5. Explica la regla de 1 s. ¿Por qué en Gemini hay que reenviar audio?
6. ¿Por qué no hay voz clonada con Gemini?
7. ¿Cuáles son los 5 nodos del analista y en cuáles hay LLM?
8. ¿Cómo se fusionan texto y voz si discrepan?
9. ¿Qué cambia la emoción en el comportamiento del agente y qué nunca cambia?
10. ¿Por qué miedo y tristeza van antes que frustración en la política de estilo?
11. ¿Cómo mueve los labios el slime? Nombra las tres bandas.
12. ¿Qué parte del avatar humano es tuya y cuál de terceros? ¿Qué prohíbe su licencia?
13. Diferencia entre herramienta y MCP. ¿Dónde se usó MCP en el proyecto?
14. ¿Qué es SDD y cómo ayudó a trabajar con varios agentes de IA?
15. ¿Por qué no RAG ni text-to-SQL?
16. Tres cosas no verificadas o no cumplidas.
17. ¿Por qué los modelos realtime se encarecen en llamadas largas y qué harías?
18. ¿Cómo propondrías el agente supervisor del proyecto macro?
19. ¿Qué cambiarías para adultos mayores (4 cosas)?
20. ¿Qué hiciste tú y qué hizo tu compañero en el hackatón? ¿Y en el fork?

**Respuestas:** 1 `01` §4 · 2 `02` §1 · 3 `01` §3.3 · 4 `02` §4 · 5 `02` §1 · 6 `02` §2 · 7 `01` §3.5 ·
8 `02` §5 · 9 `01` §7 · 10 `01` §7 · 11 `02` §7 · 12 `02` §7 · 13 `02b` (MCP) y `04` D6 · 14 `02` §9 ·
15 `02` §3 · 16 `07` · 17 `05` P42–43 y `03` · 18 `02` §4 · 19 `04` D15 · 20 `01` §2 y `05` P1.
