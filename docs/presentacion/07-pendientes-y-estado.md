# 07 · Estado real y pendientes

Foto del **2026-10-18**, rama `feat/presentacion` (último commit de código: `79395c1`, 17-oct). Otros
agentes están puliendo la interfaz y la estabilidad de voz en paralelo: al escribir esto había **26
archivos de código modificados sin commit** (componentes de la consola y del admin, estilos, motores de
voz, `config.py`, el prompt). **Lo marcado «verificar» puede haber cambiado** cuando leas esto;
compruébalo con `git status`, `git log` y probando. Las pruebas de la §2 se corrieron sobre el árbol de
trabajo de ese momento.

Leyenda: ✅ verificado (con fecha y cómo) · 🟡 funciona pero con límites o verificación parcial ·
❌ no verificado / no cumplido · 🔧 pendiente de hacer.

---

## 1. Qué funciona y está verificado

| Capacidad | Estado | Evidencia |
|---|---|---|
| Las 9 herramientas con cifras iguales a la evidencia | ✅ 17-oct, en vivo con Gemini | `CHANGELOG.md` «Validación previa a publicar» |
| Fuente caída o lenta, argumento inválido, municipio homónimo, sesión vencida, analizador caído, motor caído con cambio a OpenAI | ✅ 17-oct, en vivo | ídem |
| Front en producción: 3 temas × 3 páginas × escritorio y Android **emulado**, contraste AA | ✅ 17-oct | ídem |
| 0 alucinaciones en 20 casos trampa (OpenAI, prompt v2) | ✅ 9-oct | `docs/anexos/eval-grounding-2026-10-09.md` |
| Latencia p50 3,9 s (OpenAI) / 4,2 s (Gemini) | ✅ 9-oct, n = 10, servidor local | `docs/anexos/bench-latencia-2026-10-09.md` |
| 8 evaluadores simultáneos sin fugas | ✅ 9-oct | `docs/anexos/concurrencia-2026-10-09.md` |
| Regla de 1 s en Gemini | ✅ 16-oct, 5 de 6, micrófono **simulado** con WAV | `docs/08` §6 |
| Nota de estilo cambia la respuesta (120 → 43 palabras con `directo`) | ✅ 16-oct, OpenAI en vivo | `docs/10` §6 |
| Evaluación de emociones (39 frases) | ✅ 16-oct | `docs/10` §6 |
| Voz clonada con Cartesia sobre OpenAI, respuesta completa sin interrupciones | ✅ 9-oct, en caliente | `CHANGELOG.md` «Fixed — producción» |
| Ráfagas de ruido como micrófono: 0 detecciones, 0 turnos fantasma (OpenAI) | ✅ 9-oct | ídem |
| Slime: estados y expresiones en Edge, `prefers-reduced-motion`, 0 errores de consola | ✅ 15-oct | `CHANGELOG.md` «Changed — Avatar» |
| Despliegue de prueba en Vercel desde el fork | 🟡 simulado en local el 17-oct; el changelog dice «validado en producción» | `docs/11` §11 — **confirma la URL de producción** y anótala en el README (hoy dice «Pendiente») |

## 2. Pruebas automáticas (ejecutadas hoy)

| Suite | Resultado | Nota |
|---|---|---|
| `cd web && npm test` (vitest) | ✅ **413/413** en 24 archivos | — |
| `pytest` | 🟡 **166 pasan, 1 falla, 9 saltadas** (sondas en vivo) | Falla `tests/integrations/test_socrata_client.py::test_stale_cache_only_when_the_source_fails`: con `cache_fresh_s=0`, en Windows `time.monotonic()` no avanza entre dos llamadas seguidas y la entrada sigue «fresca». **Es de la prueba, no del producto**; correr en Linux o arreglar la prueba (p. ej. inyectar el reloj o usar `cache_fresh_s=-1`). |
| `cd web && npm run test:e2e` (Playwright, 70 pruebas) | ❌ **no ejecutado hoy** | El último registro local (`web/tests/test-results/.last-run.json`, 16-oct 17:16) terminó con **57 fallos**, por tiempo de espera buscando controles (p. ej. `#btn-direct`): probablemente **selectores desalineados** tras mover controles a `/admin` y rediseñar la consola. 🔧 Actualizar las pruebas e2e o, como mínimo, no citarlas como «en verde». |
| `README.md` | 🔧 | Dice «85 pruebas del backend» y «134 de front»: **desactualizado** (hoy 167 y 413 + 70 e2e). |

## 3. Lo que no se ha probado en dispositivos o condiciones reales

| Qué | Por qué importa | Qué hacer |
|---|---|---|
| ❌ **Eco con parlantes reales** (el agente se oye a sí mismo y se interrumpe) | En el navegador sin interfaz el agente no vuelve al micrófono; con `echoCancellation: "all"` no está probado en una sala | Ensayar con los parlantes del lugar; si pasa, **audífonos** |
| ❌ **Regla de 1 s con ruido real** de micrófono y voces humanas (no WAV) | Medida con micrófono simulado | Ensayo con ruido de fondo real |
| ❌ **Análisis de emoción por voz con voz humana** (A-21) | Con voces sintéticas el modelo no distinguió tono tenso de calmado | Grabar la misma frase en tono tenso y calmado (con consentimiento) y comparar |
| ❌ **Latencia de extremo a extremo con voz clonada** | Solo se midió el primer audio de Cartesia (321 ms) | HUD de `/admin` → Tiempos, 10 turnos |
| ❌ **iPhone / Safari** (modo juego con pseudo pantalla completa, permiso del sensor) | Solo hay validación en Android emulado | Probar si se va a mostrar en iPhone; si no, usar Android |
| 🟡 **Android real** con modo juego (inclinación, vibración) | Validado emulado | Probar en el teléfono que llevarás |
| ❌ **Usuarios reales, en especial adultos mayores** | Toda la hipótesis de diseño (slime, juego, ánimo) | Trabajo futuro; no lo presentes como validado |
| ❌ **Evaluación de grounding con el prompt v9 y con Gemini** | La de 20 casos fue con OpenAI y prompt v2 | `python -m scripts.eval_grounding` con Gemini (de pago) si hay tiempo |
| ❌ **Meta de latencia p95 ≤ 4,0 s** | OpenAI 4,7 s; Gemini 6,9 s | Decirlo tal cual |

## 4. Pendientes conocidos (P2/P3) del CHANGELOG, las validaciones y el feedback

| # | Pendiente | Origen | Prioridad para la presentación |
|---|---|---|---|
| 1 | ✅ **Degradación de la voz en conversaciones largas**: hecho el 18-oct. Renovación cada 6 turnos o 20.000 tokens con resumen de turnos antiguos, compresión de Gemini 32k → 16k, prompt `reto01-ips-v10` con bloque «VOZ». Probado con Gemini real en 13 preguntas escritas (ver `02`) | Feedback del compañero | Pendiente: probar una conversación larga **por voz** y con OpenAI en el ensayo |
| 2 | ✅ **«Silenciar»**: arreglado el 18-oct (vaciaba solo lo que sonaba; ahora silencia el resto del turno en ambos motores). Con Gemini real, 46 ms hasta «Te escucho» | Feedback | Probarlo en el ensayo |
| 3 | **Dos botones de micrófono** («Hablar» y «Usar mi voz»): «Usar mi voz» es el consentimiento para analizar el tono y abre el micrófono; «Hablar» inicia/detiene la conversación. El compañero lo leyó como dos micrófonos | Feedback | Verificar el rediseño del otro agente; en la demo, explicar en una frase |
| 4 | Contraste del botón oscuro «Detener» junto a lila; sombras y *hover* inconsistentes; tipografía; tooltips; responsividad en el móvil | Feedback (el asesor pidió aplicarlo ya) | Lo está haciendo otro agente: **revisa el resultado en móvil antes del día** |
| 5 | Sorpresa a veces etiquetada como alegría | `docs/10` §6 | Baja (mencionar si preguntan) |
| 6 | Feedback a LangSmith (hoy solo registro estructurado) | `CHANGELOG.md` | Baja |
| 7 | Detección de interrupción vs *backchannel* («ajá»), fin de turno semántico (B-14) | `docs/13` | Trabajo futuro |
| 8 | Diarización de varias voces humanas (B-07) | `docs/13` | Trabajo futuro |
| 9 | Motor 3 en cascada (B-04) — clave para costos | `docs/13`, `03` | Trabajo futuro |
| 10 | Cartesia: 3 síntesis simultáneas (la 4.ª espera en cola) | `docs/anexos/concurrencia` | Solo importa si varias personas prueban a la vez con voz clonada |
| 11 | Licencia del VRM: descargado de un espejo de GitHub, no comparado byte a byte con la descarga oficial de VRoid Hub | `web/public/avatars/LICENSE.md` | Mencionar si preguntan por licencias |
| 12 | Trabajo futuro para adultos mayores: etiquetas en todos los iconos, 1–2 botones, agente protagonista, ánimo solo en admin, quitar o justificar el modo juego, 2 demos (usuario y admin con conversaciones guardadas y métricas) | Feedback + decisión del asesor | **No aplicar ahora**: va en D15 del guion |

**Inconsistencias menores de documentación** (no afectan la demo, pero un revisor atento puede verlas):
- `docs/03-api.md` lista solo 5 herramientas en `POST /tools/{nombre}` (son 9 desde el contrato `.3`).
- `docs/08` dice «D-20 (propuesta, pendiente de anotar en 00)», pero D-20 ya está en `docs/00` §5.
- `docs/09` marca `socrata_client.py` y `lexicon.json` como «(planeado)»; ya existen.
- `docs/10` §7 llama «vigente» al prompt v2; el vigente es `reto01-ips-v10`.

## 5. Qué cambió en los últimos commits

| Commit | Fecha | Qué |
|---|---|---|
| `79395c1` | 17-oct | Errores de herramientas con su motivo real (5xx/429 → `unavailable`, 404/422 → `invalid`), `/health` dentro del plazo del navegador (sonda de 3 s), despliegue en Vercel (`Permissions-Policy`) |
| `3f5a2a5` | 17-oct | Una sesión vencida se renueva y repite la llamada una vez |
| `9506879` | 17-oct | Subtítulos solo en modo juego, con X y botón para encenderlos; «¿Cómo funciona?» en pastilla pastel |
| `66acc51` | 16-oct | Temas por avatar, slime gato, indicador de ánimo, audio (`echoCancellation: "all"`, `voiceIsolation`, `far_field`), regla de 1 s en Gemini, **Gemini por defecto** |
| `7b686d5` | 16-oct | El orbe entra por la boca; margen de la barra en modo juego |
| `20e78ef` | 16-oct | Jugar con el slime, brillo por emoción, selector de 3 personajes, **análisis de afecto auditado** |
| `fa59df7` | 16-oct | Contrato de juego (inclinación, choques, modo juego, comerse el orbe) |
| `dd586a3` · `2ab8681` | 15–16 oct | Slime rosado por defecto, caras según el tono, paleta rosado + violeta |

---

## 6. Tareas antes de la presentación

### Imprescindibles
- [ ] **Confirmar la URL de producción** y que `/api/health` dé `status: ok`, `source.ok: true`.
- [ ] Decidir el motor de la demo. **Para voz clonada: `VOICE_DEFAULT_ENGINE=openai`** en Vercel + `OPENAI_API_KEY` + `CARTESIA_API_KEY` + `CARTESIA_VOICE_ID` → **Redeploy**. Comprobar `default_engine: openai` y `voice_modes` con `cloned`.
- [ ] Comprobar créditos en OpenAI, Google y Cartesia; poner topes de gasto.
- [ ] **Ensayar la demo completa** del `04` en la URL de producción, con micrófono real, **dos veces**.
- [ ] Probar los parlantes de la sala (o los que usarás); llevar **audífonos**.
- [ ] **Grabar el video de respaldo** de la demo.
- [ ] Revisar en el móvil el resultado del pulido visual que hacen otros agentes (botones, contraste, responsividad, «Silenciar», los dos botones de voz).
- [ ] Saber **de quién es la voz clonada** (en Cartesia figura como «Juan») y tener su consentimiento a mano: lo pueden preguntar.

### Recomendadas
- [ ] Conversación larga de prueba (≥ 15 turnos) para ver si la voz se degrada; si pasa, decidir: demo corta o implementar la renovación cada N turnos (pendiente 1).
- [ ] Probar el modo juego en el Android que llevarás.
- [ ] Actualizar el README: URL pública y conteos de pruebas.
- [ ] Arreglar o reescribir las pruebas e2e de Playwright (o no mencionarlas como «en verde»).
- [ ] Arreglar la prueba de caché que falla en Windows.
- [ ] Si hay presupuesto: repetir `scripts/eval_grounding.py` con el prompt v9 (y con Gemini) para poder decir «0 alucinaciones con la versión actual».

### Si sobra tiempo
- [ ] Una grabación humana tensa/calmada para A-21 (con consentimiento) y anotarla en el CHANGELOG.
- [ ] Medir 10 turnos con voz clonada en el HUD para tener la latencia de extremo a extremo.
- [ ] Corregir las inconsistencias menores de documentación de la §4.
