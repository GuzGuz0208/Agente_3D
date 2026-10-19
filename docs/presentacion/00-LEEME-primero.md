# 00 · Léeme primero: cómo usar este paquete de estudio

Paquete para preparar la presentación del proyecto (20 min + 10 min de demo) ante un grupo de
investigación en sistemas interactivos y agentes multimodales. Está pensado para estudiarlo **con un
chat de IA que haga de tutor y examinador**, con acceso a esta carpeta del repo.

Todo sale del repo (código, `CHANGELOG.md`, `docs/00–13`, `docs/anexos/`) y de pruebas ejecutadas el
2026-10-18. Lo que no está verificado está marcado como tal.

---

## Mapa del paquete

| Archivo | Qué contiene | Cuándo usarlo |
|---|---|---|
| `00-LEEME-primero.md` | Este archivo: mapa, orden de carga y prompt para el chat de estudio | Primero |
| [`feedback-recibido.md`](feedback-recibido.md) | Feedback del compañero, comentarios JS1–JS7 del asesor, derrotero original y decisiones del dueño | Para entender por qué el guion es como es |
| [`01-el-proyecto-completo.md`](01-el-proyecto-completo.md) | Qué es, cronología, arquitectura con diagrama, endpoints, 9 herramientas, verificador, analista, despliegue, **por qué esta arquitectura (JS4)**, un turno de punta a punta, **el prompt del agente comentado**, la política de estilo, cifras clave y **mapa de archivos** | La base de todo |
| [`02-como-se-hizo-cada-cosa.md`](02-como-se-hizo-cada-cosa.md) | Cada componente por dentro, cómo se construyó, alternativas descartadas, con «Qué decir en 1 frase» y «Si preguntan…» | Para entender a fondo y defender |
| [`02b-glosario.md`](02b-glosario.md) | ≈ 90 términos técnicos con el ejemplo del proyecto | Consulta continua |
| [`03-investigacion-costos-y-estado-del-arte.md`](03-investigacion-costos-y-estado-del-arte.md) | Costos y estrategias de reducción, supresión de ruido, reconocimiento de hablante, MCP vs herramienta, agente supervisor, estado del arte y marco de investigación (lo escribió otro agente) | Para las diapositivas de costos y las preguntas de investigación |
| [`04-guion-presentacion-20-10.md`](04-guion-presentacion-20-10.md) | Guion minuto a minuto (16 diapositivas) aplicando JS1–JS7, **guion de la demo de 10 min**, plan B y checklist del día | Para montar las diapositivas y ensayar |
| [`05-preguntas-probables.md`](05-preguntas-probables.md) | 53 preguntas con respuesta modelo, las difíciles marcadas ⚠ | Para ensayar en voz alta |
| [`06-plan-de-estudio.md`](06-plan-de-estudio.md) | Qué estudiar y en qué orden (≈ 12–14 h), qué saber de memoria, ejercicios, lecturas y autoevaluación de 20 preguntas | Para organizar el tiempo |
| [`07-pendientes-y-estado.md`](07-pendientes-y-estado.md) | Estado real: qué está verificado, qué no, pruebas de hoy, pendientes y tareas antes de la presentación | Antes de cada ensayo y la víspera |

---

## Qué cargar en el chat de estudio y en qué orden

**Mínimo (si el chat tiene poco contexto):** `00`, `feedback-recibido.md`, `01`, `02`, `05`, `07`.

**Completo (recomendado):**
1. `00-LEEME-primero.md`
2. `feedback-recibido.md`
3. `01-el-proyecto-completo.md`
4. `02-como-se-hizo-cada-cosa.md`
5. `02b-glosario.md`
6. `03-investigacion-costos-y-estado-del-arte.md`
7. `04-guion-presentacion-20-10.md`
8. `05-preguntas-probables.md`
9. `06-plan-de-estudio.md`
10. `07-pendientes-y-estado.md`

**Si el chat puede leer el repo**, que consulte además, cuando haga falta precisión:
`config/domains/reto01_ips.yaml` (prompt), `config/style_policy.yaml`, `docs/00-contexto-y-decisiones.md`
(decisiones D-xx), `docs/07` (requisitos y escenarios A-xx), `docs/08` (voz), `docs/09` (datos),
`docs/10` (afecto), `CHANGELOG.md` y `docs/anexos/`.

---

## Prompt inicial sugerido para el chat de estudio

Copia y pega esto al empezar la sesión (después de cargar los archivos):

```text
Vas a ser mi tutor y examinador para preparar una presentación técnica de 20 minutos + 10 minutos de
demo ante un grupo de investigación en sistemas interactivos y agentes multimodales (parte del público
es de España). El proyecto es un agente social de voz que construí: está descrito en los archivos de
docs/presentacion/ que te cargué (empieza por 00-LEEME-primero.md) y en el repo.

Reglas para ti:
1. Básate SOLO en los archivos del paquete y del repo. Si algo no está ahí, dilo: no inventes cifras,
   nombres de modelos ni resultados. Distingue siempre lo verificado de lo no verificado (07).
2. Habla en español, claro y técnicamente preciso. Cuando uses un término técnico, comprueba que lo
   entiendo (el glosario es 02b).
3. Trabaja por sesiones cortas siguiendo el plan de 06-plan-de-estudio.md. Al empezar cada sesión,
   pregúntame qué bloque toca y cuánto tiempo tengo.
4. Modo tutor: explícame un componente en pocas frases, luego pídeme que te lo explique yo con mis
   palabras, y corrígeme señalando qué faltó o qué fue impreciso.
5. Modo examinador: hazme preguntas como las haría un investigador exigente (usa 05-preguntas-probables.md
   como base, pero también repreguntas y variantes). Una pregunta a la vez. Después de mi respuesta,
   puntúala de 1 a 5 (precisión, claridad, honestidad sobre límites), dime qué diría una respuesta
   excelente y cita el archivo que lo respalda.
6. Insiste en las preguntas marcadas ⚠ y en: qué hice yo y qué hizo la IA o mi compañero; qué es propio
   y qué es librería en el avatar; herramienta vs MCP; por qué esta arquitectura del backend; cómo se
   evalúan las emociones; costos; agente supervisor.
7. Ensayo del guion: cuando te lo pida, cronométrame mentalmente por diapositiva (04) y dime si me
   paso, si uso la palabra «IPS» sin explicarla (el público es español) o si digo una cifra sin su matiz.
8. Al final de cada sesión, dame un resumen de 5 líneas: qué domino, qué no, y qué repasar.

Empieza preguntándome cuánto tiempo tengo hoy y cuál es mi nivel con: WebSocket, VAD, function calling,
LangGraph, three.js y SoQL. Luego proponme el plan de la sesión.
```

### Variantes útiles para pedirle al chat

- «Hazme un simulacro de 10 preguntas mezcladas, como el grupo, sin pistas».
- «Explícame el turno de punta a punta (01 §5) y luego pídeme que lo repita en 3 minutos».
- «Hazme de abogado del diablo sobre el análisis de emociones y la ética (AI Act)».
- «Revisa esta diapositiva que escribí [pegar texto] contra el 04 y el 01: ¿qué sobra, qué falta, qué es impreciso?».
- «Dame 5 preguntas de seguimiento a mi respuesta sobre la arquitectura del backend».
- «¿Qué cosas del 07 no debo afirmar como verificadas en la presentación?».

---

## Cinco cosas que no debes olvidar

1. **No digas «IPS» sin explicarlo**: «puntos de atención médica: hospitales, clínicas, consultorios; allí se llaman IPS».
2. **La fuente es intercambiable** (JS3): el REPS es el caso de la demo.
3. **Herramienta ≠ MCP** (JS7): en ejecución hay herramientas; MCP se usó en el desarrollo.
4. **Propio vs librería en el avatar**: slime, gato y orbe son código propio sobre three.js; el humano es un modelo de VRoid animado por ti con `@pixiv/three-vrm`.
5. **Di los límites antes de que te los pregunten**: p95 > 4 s, emoción por voz no validada con humanos, 20 casos de grounding con el prompt v2, sin usuarios reales todavía.
