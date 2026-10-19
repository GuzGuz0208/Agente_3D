# 02 · Cómo se hizo cada cosa

Por componente: cómo funciona por dentro, cómo se construyó, qué se decidió y qué se descartó.
Cada sección cierra con **«Qué decir en 1 frase»** y **«Si preguntan…»**.
Las rutas son del repo; las decisiones `D-xx` están en `docs/00` §5 y las reglas `R-xx` en `AGENTS.md`.

Índice: 1 Voz en tiempo real · 2 Voz clonada · 3 Datos en vivo · 4 Verificador · 5 Emociones ·
6 Ánimo visible y brillo · 7 Avatares · 8 Temas, ayuda, modo juego · 9 SDD · 10 Trabajo con
varios agentes de IA · 11 Pruebas · 12 Despliegue

---

## 1. Voz en tiempo real

### Cómo funciona

**Speech-to-speech nativo desde el navegador.** No hay una cadena «reconocimiento → LLM → síntesis»
armada por nosotros: un único modelo de voz en tiempo real (OpenAI Realtime `gpt-realtime-2.1` o
Gemini Live `gemini-3.8-live`) oye, decide el turno, llama herramientas y habla. El navegador abre un
WebSocket directo con el proveedor usando una credencial efímera que emite el backend.

**Un puerto, dos adaptadores.** `VoiceEngine` (`web/src/voice/types.ts`) es el contrato: `connect`,
`disconnect`, `sendText`, `interrupt`, `applyStyle`, `seed` y eventos **neutrales**: `status`,
`transcript`, `tool_call`, `tool_result`, `speech`, `interrupted`, `latency`, `session`, `error`.
`realtime-base.ts` (≈ 1.500 líneas) tiene todo lo que no depende del proveedor; `openai-engine.ts` y
`gemini-engine.ts` solo traducen protocolos. Ningún nombre de evento ni formato de un proveedor sale
de su adaptador (R-03). Por eso el resto del front (controlador, store, paneles, avatar) no sabe qué
motor está hablando, y se puede cambiar de motor a mitad de conversación.

**Un solo stack de audio.** `MicTap` (`audio/mic-tap.ts` + `public/worklets/mic-capture.js`):
`getUserMedia` → filtro paso bajo → `AudioWorklet` → PCM16 mono, remuestreado al ritmo de cada
proveedor (24 kHz OpenAI, 16 kHz Gemini). Guarda un **anillo con los últimos 30 s** (para recortar el
audio que va al analista y para reenviar voz en Gemini) y un VAD de energía local. `PcmPlayer`
(`audio/player.ts`): reproduce PCM16 a 24 kHz en una cola de `AudioBufferSourceNode` con **máximo
2 s programados**, de modo que `flush()` corta al instante; lleva los ms reproducidos por
generación y tiene un `AnalyserNode` para el lip-sync.

### Diferencias entre motores (medidas en el spike G2, `docs/anexos/g2-…` §4)

| | OpenAI Realtime | Gemini Live |
|---|---|---|
| Credencial | Secreto `ek_…` de un solo uso; va como *subprotocolo* del WebSocket. **No bloquea** la configuración (por eso el backend valida cada herramienta) | Token en la URL que **bloquea** la configuración (modelo, prompt, herramientas) |
| Micrófono | PCM16 a 24 kHz (16 kHz se rechaza) | PCM16 a 16 kHz |
| Estilo | `session.update` con las directivas | Nota de contexto con `turnComplete: false`, **esperando el hueco entre turnos** (si no, corta la respuesta) |
| Salida de solo texto | Sí → permite la voz clonada | **No** (`1007 … (TEXT) is not supported`) → sin voz clonada |
| Duración | Según documentación | Conexión ≈ 10 min con aviso `goAway`; token ≈ 30 min |
| Interrupción | `interrupt_response: false`; el navegador corta y manda `conversation.item.truncate` con lo realmente reproducido | `activityHandling: NO_INTERRUPTION`; el navegador corta con un turno de cliente (`turnComplete: true`) y reenvía la voz |

**OpenAI vs Gemini, en cifras** (`docs/00` §6): primer audio útil con consulta p50 **3,9 s** (OpenAI)
y **4,2 s** (Gemini), p95 4,7 y 6,9 s. Gemini es el **motor por defecto para pruebas**
(`VOICE_DEFAULT_ENGINE=gemini`) para no gastar la cuota de OpenAI; para la demo con voz clonada se
pone `openai`. Costos: según el compañero, Gemini Live cuesta «la mitad» que OpenAI Realtime; la
estimación de `03` §1.4 matiza: por minuto de lista ≈ ¼, pero como Gemini no tiene caché y vuelve a
cobrar el contexto, hacia los 7–8 minutos de llamada sale **más caro** que OpenAI con caché.

### La regla de 1 s (ruido vs interrupción)

Problema: en un sitio con ruido, cualquier sonido cortaba al agente. Solución (R-24, `docs/08` §6,
constantes en `realtime-base.ts`: `BARGE_CONFIRM_MS = 1000`, `DUCK_LEVEL = 0.3`):

1. Mientras el agente habla y se detecta voz, **se baja su volumen al 30 %** (*ducking*).
2. Si la voz dura **≥ 1 s**, es una interrupción: se para la reproducción, se vacía la cola, se fija
   `played_ms` y el `delivered_text` (solo lo que se oyó); el turno nuevo atiende lo que dijo la persona.
3. Si dura menos, era ruido: el volumen vuelve y el agente sigue sin responder nada.

En **OpenAI** el inicio y fin de voz los da el VAD del servidor (`server_vad`, umbral 0,65, silencio
500 ms) con `interrupt_response: false`. En **Gemini**, con `NO_INTERRUPTION` el servidor **no oye**
mientras habla (verificado el 16-oct), así que: (a) el navegador detecta la voz con su VAD local
(inicio con 40 ms de voz, fin con 300 ms de silencio; confirma a 1,3 s); (b) corta con un turno de
cliente `turnComplete: true` (≈ 200 ms); (c) **reenvía desde el anillo** la voz que el servidor no
oyó; (d) adopta el `ACTIVITY_START` como el mismo enunciado. Medido: ruido de 0,4 s y voz de 0,8 s no
cortan (2/2); pregunta de 3,4 s corta y se responde completa (**5 de 6**).

### Filtro de alucinaciones del reconocimiento (`web/src/voice/transcript-filter.ts`)

Los transcriptores inventan texto sobre ruido o silencio: «公主。», «Gracias por ver el video»,
«Subtítulos realizados por la comunidad de Amara.org». Un texto con alfabetos ajenos, menos de 2
letras, solo muletillas («mmm») o una frase típica de alucinación (comparada **entera**, no como
subcadena: «gracias, eso es todo» sigue valiendo) **no se muestra, no se responde y no se analiza**;
se cancela la respuesta del motor. Origen: un fallo en producción el 9-oct, donde además la «pista de
contexto» del transcriptor de OpenAI se repetía como si la persona la dijera (se quitó, `6fdf7fa`).

### Renovación de sesión y cambio de motor (D-18, `docs/08` §7)

- Renovación **proactiva entre turnos**, nunca a mitad de una respuesta, ante `goAway` (Gemini) o
  credencial vencida (`transportExpiring`).
- Conexión caída sin aviso → se renueva el mismo motor una vez; una segunda caída en 30 s → el
  controlador **cambia de motor**. Límite: ≤ 2 intentos de motor por turno (R-25).
- El motor nuevo se **siembra** con un **sobre de contexto neutral**: estado confirmado, últimos 4
  turnos (solo lo escuchado) y hasta 5 resultados de herramienta compactos (`seed_note` en
  `src/services/realtime_service.py`). No se copian IDs del proveedor ni razonamiento oculto. No se
  repite audio ni se re-ejecuta una herramienta (idempotencia por `tool_call_id`).
- Gemini se configura además con `sessionResumption` y `contextWindowCompression: slidingWindow`
  (`gemini_session.py`).
- **Sesión de nuestra API vencida** (token de 2 h): el front la renueva y repite la llamada una vez
  (`3f5a2a5`, 17-oct).

> **Renovación de contexto (hecha y probada con Gemini real el 18-oct):** el compañero observó que en
> conversaciones largas **la voz se degrada** (cambia de entonación) y propuso «restablecer el búfer
> cada X turnos». Se implementó sobre la pieza que ya existía (renovar entre turnos con el sobre de
> contexto), en `web/src/voice/realtime-base.ts`, para los dos motores:
> - **Cuándo:** cada `VOICE_REFRESH_TURNS = 6` turnos o al pasar de `VOICE_REFRESH_TOKENS = 20000` tokens
>   de contexto (los reporta el proveedor: Gemini `usageMetadata.promptTokenCount`, OpenAI
>   `response.usage.input_tokens`). Solo entre turnos: nada sonando ni en cola, sin herramienta en curso y
>   sin voz local en los últimos 700 ms.
> - **Siembra:** filtros confirmados, últimas 8 intervenciones y un **resumen de los turnos antiguos**
>   (`olderTurnsSummary`, ≤ 1.600 caracteres); sin repetir saludo ni consultas; la voz (`Kore`/`marin`) se
>   fija explícitamente en cada sesión.
> - **Red de seguridad en Gemini:** compresión de ventana deslizante 32k → 16k tokens.
> - **Prompt `reto01-ips-v10`:** bloque «VOZ»: español de Colombia siempre, la misma voz, ritmo y
>   entonación serena, sin imitar a la persona.
> - **Medido:** dos renovaciones en una conversación de 13 preguntas (tras los turnos 6 y 12), 0,7 s cada
>   una, sin el estado «Un momento»; el contexto bajó de ≈ 6.100 a ≈ 4.000 tokens; con el resumen, el
>   agente recordó la primera cifra (837 IPS en Antioquia) tras la segunda renovación.
> - **Además abarata** las llamadas largas, porque el contexto deja de crecer (ver `03` §1.5).
> - **No probado:** conversación larga **por voz** y con OpenAI real; la percepción de la deriva por
>   personas. Una vez el acuse salió en inglés tras renovar; el prompt v10 lo refuerza, sin reprobar.
>
> **«Silenciar»** también se arregló: vacía el reproductor, descarta lo retenido y silencia el resto del
> turno (OpenAI `response.cancel` + `truncate`; Gemini cierra el turno con una nota de silencio), sin
> enviar la corrección de cifras de ese turno. Con Gemini real el estado pasó a «Te escucho» en 46 ms y
> solo sonaron 38 ms de audio tras el clic.

### Eco y ruido

- Micrófono con `echoCancellation: "all"` (cancela también lo que suena por Web Audio, no solo lo de
  una llamada WebRTC), `noiseSuppression`, `autoGainControl`, `voiceIsolation`; si el navegador
  rechaza esas restricciones, reintenta con las clásicas (`web/tests/contract/mic-constraints.test.ts`).
- OpenAI: `input_audio_noise_reduction = far_field` (micrófono de PC o sala; `near_field` con diadema).
- Gemini: `START_SENSITIVITY_LOW` (el ruido ambiente no cuenta como inicio de voz).
- **Sin verificar:** eco real con los parlantes del lugar. Si el agente se oye a sí mismo, **audífonos**.

**Qué decir en 1 frase:** «La voz es speech-to-speech nativo directo del navegador al proveedor; yo
diseñé un contrato de eventos neutrales para poder cambiar entre OpenAI y Gemini en vivo, y una
regla de 1 segundo para que el ruido no corte al agente pero una pregunta real sí».

**Si preguntan…**
- *¿Por qué no una cascada STT→LLM→TTS?* Era el «motor 3» (backlog B-04). En 6 horas, el
  speech-to-speech daba la mejor latencia e interrupciones sin orquestarlas nosotros. La cascada es
  más barata y controlable; es la línea de trabajo futuro de costos (ver `03`).
- *¿Por qué no WebRTC?* WebSocket sobre 443 evita redes que bloquean UDP y es igual en los dos
  proveedores; WebRTC queda como opción.
- *¿Cómo sabes qué oyó la persona?* Por los ms reproducidos (`played_ms`) y, con voz clonada, por
  las marcas de tiempo por palabra de Cartesia; el historial usa solo lo escuchado.

---

## 2. Voz clonada (Cartesia)

### Cómo funciona (D-20, D-22, `docs/08` §15)

El motor (solo **OpenAI**) responde en **solo texto** (`output_modalities: ["text"]`); el navegador
lo corta **por frases** y lo manda a Cartesia `sonic-3.6` por otro WebSocket directo (token de 600 s
con alcance solo de síntesis, emitido por `POST /speech/session`). Cartesia devuelve PCM16 a 24 kHz
—el mismo formato del reproductor— y **marcas de tiempo por palabra** (24 marcas en español, medido),
con las que se calcula exactamente qué texto oyó la persona si interrumpe. Es un **decorador**:
`withSynthesizer(engine, synth)` devuelve otro `VoiceEngine`, así que el resto de la interfaz no
distingue una voz de otra.

**Degradación automática:** si Cartesia falla al conectar, a mitad de respuesta o se agotan créditos,
se vuelve a la voz del motor (pegajosa: no vuelve sola), sin consumir intentos de motor.

**Medido:** primer audio de Cartesia 321 ms con conexión caliente; abrir la conexión tarda 1,5 s
(por eso se abre al conectar y se reutiliza). **No medido:** la latencia de extremo a extremo con voz
clonada. **Límite:** el plan Pro permite **3 síntesis simultáneas**; la 4.ª espera en cola (no falla).

### Por qué no con Gemini

Los tres modelos de Gemini Live disponibles rechazan la salida de solo texto (verificado el 9-oct).
La alternativa —silenciar el audio de Gemini y sintetizar su transcripción— se descartó: se paga dos
veces y la transcripción llega **después** del audio (la peor latencia).

### Salvaguardas

Solo se clona la voz de una persona del equipo, con consentimiento; el audio del micrófono **nunca**
va a Cartesia (solo el texto del agente); el agente se presenta como IA y nunca como la persona cuya
voz usa; el estilo cambia las palabras, no la prosodia de Cartesia.

**Qué decir en 1 frase:** «Con OpenAI, el motor solo piensa en texto y la voz la pone Cartesia con
una voz clonada del equipo, por frases y con marcas por palabra para saber exactamente qué se oyó».

**Si preguntan…**
- *¿Por qué una voz clonada?* Identidad propia del agente y coherencia avatar-voz (D-21/D-22).
- *¿Riesgos éticos?* Deepfake de voz: consentimiento por escrito, revocable, aviso de voz sintética,
  sin clonar a terceros. El AI Act (art. 50) exige identificar el audio sintético.
- *¿Cuánto cuesta?* 1 crédito por carácter (≈ 750–800 por minuto de audio), plan Pro 5 USD/mes con
  100.000 créditos (precios leídos el 9-oct, `docs/11` §10).

---

## 3. Datos en vivo (datos.gov.co)

### Cómo funciona (D-12, D-13, `docs/09`)

- **SoQL** (el lenguaje de consultas de Socrata, parecido a SQL) contra la API **SODA3**
  (`POST /api/v3/views/s2ru-bqt6/query.json`), con `httpx` asíncrono y una conexión persistente.
- **Herramientas tipadas:** el modelo manda JSON (p. ej. `{"metric": "capacity_sum", "filters":
  {"capacity_group": "CAMAS"}}`); el servidor valida con Pydantic (campos desconocidos = rechazo),
  resuelve nombres con el léxico (homónimos → pregunta, **nunca elige el primero**) y arma la SoQL
  con columnas y funciones de lista cerrada (`soql.py`), escapando literales.
- **Grano correcto:** contar IPS = `count(DISTINCT c_digo_prestador)`, no filas; sumar capacidad solo
  dentro de un grupo; «sin nivel registrado» ≠ nivel 0; nulo ≠ 0.
- **Sobre de evidencia** (C-EVIDENCE): `status` (`ok`, `empty`, `ambiguous`, `unavailable`,
  `invalid`), `data`, `evidence` (fuente, corte, huella de la consulta, `cache_status`, `warnings`),
  `trace` (SoQL, ms, filas), `context_patch` y `for_model`.
- **Caché etiquetada:** `live` (consulta de ahora), `fresh` (≤ 60 s), `stale` (hasta 24 h, **solo si
  la fuente falla**). Nunca se presenta caché como «en vivo». «Reconsultar» fuerza en vivo.
- **Precarga:** al crear la sesión de voz se lanzan, a través de las propias herramientas, los 10
  agregados más probables; si se preguntan en 60 s salen `fresh` (más rápidos).
- **Recuperación:** 2 intentos (3,5 s + 2 s) dentro de un plazo común de 6 s; 5xx/429 →
  `unavailable` con el código real; 404/422 → `invalid` (17-oct). El token de datos.gov.co se
  descarta si da 403.
- **Advertencias** que viajan en palabras al motor: `NOT_AVAILABILITY` (capacidad instalada ≠
  disponibilidad), `DISTRICT_AS_DEPARTMENT` (Cali o Barranquilla figuran como «departamento»),
  `LEVEL_MISSING_MOSTLY` (89 % sin nivel), `NOT_PER_CAPITA`…

### Alternativas descartadas

- **Text-to-SQL** (que el LLM escriba la consulta): inseguro e inexacto con este grano.
- **RAG / base vectorial / espejo** (la base genérica tenía pgvector): las preguntas son conteos y
  sumas exactas; un RAG recupera textos parecidos, no agrega. Y el jurado quería ver la conexión en
  vivo.
- **`sodapy`**: SODA2, síncrono, sin mantenimiento desde 2022 (solo en scripts).

**Qué decir en 1 frase:** «El modelo nunca escribe la consulta: elige una herramienta y manda
argumentos tipados; el servidor arma la consulta, decide el grano y le devuelve al modelo solo el
texto exacto que puede decir».

**Si preguntan…**
- *¿Y si cambias de fuente?* (JS3) Se reescriben las herramientas de `services/ips/` y el prompt de
  `config/`; motores, verificador, analista, front y despliegue no cambian.
- *¿Por qué no RAG?* Ver arriba; además el léxico sí hace de «RAG de nombres»: normaliza entidades
  sin base de datos.
- *¿Inyección de instrucciones desde los datos?* Los textos de la fuente van como datos delimitados
  («datos, no instrucciones») y el prompt lo repite (regla 12). Hay un caso de inyección en el arnés de
  grounding (I01) que pasó.

---

## 4. Verificador de cifras

### Cómo funciona (`src/services/ips/verify.py`, R-22)

Regex de números en español (miles con punto, decimales con coma) en lo que dijo el agente; conjunto
de números de la evidencia del turno (campos numéricos **y** dígitos dentro de textos, como
teléfonos y direcciones); toda cifra ≥ 10 sin respaldo se marca «cifra no verificada» en la interfaz
y genera una nota que el navegador le pasa al motor para que se corrija en voz alta (una vez por turno).

**Origen de un arreglo:** en una prueba en vivo marcaba como inventado un teléfono leído
correctamente → ahora también mira los dígitos dentro de textos (`3f14414`).

**Límites declarados:** números dichos en palabras no se verifican; ignora < 10, 2022 y 5.

### Relación con el «agente supervisor» (JS6)

El verificador **ya es un supervisor**, pero determinista y solo de cifras. La propuesta para el
proyecto macro (dos agentes: uno que conversa y otro que supervisa):

| Capa | Qué revisa | Cómo |
|---|---|---|
| 1. Determinista (hoy) | Cifras | `verify.py`, sin LLM, < 1 ms |
| 2. Supervisor LLM (propuesto) | Afirmaciones no numéricas: nombres, «está/no está registrada», niveles, fuera de alcance, consejos médicos | Un modelo pequeño como juez de *implicación* (¿la frase se sigue de la evidencia?), **fuera de la ruta crítica**, en paralelo, con la misma nota de autocorrección |
| 3. Evaluación offline | Regresiones | El arnés `scripts/eval_grounding.py` con casos trampa, por versión de prompt |

Ventaja de este diseño frente a «un LLM vigila a otro LLM» puro: lo verificable con reglas se
verifica con reglas (barato, explicable, sin alucinaciones del vigilante) y el LLM supervisor solo
juzga lo que las reglas no pueden.

**Qué decir en 1 frase:** «Hay tres barreras contra la alucinación: un prompt de mundo cerrado, un
texto exacto que recibe el modelo como resultado de la herramienta, y un verificador que revisa
cada cifra dicha y hace que el agente se corrija en voz alta».

**Si preguntan…** *¿Y si el error no es una cifra?* Hoy no se detecta automáticamente; es justo el
hueco que llenaría el supervisor LLM de la capa 2.

---

## 5. Emociones (análisis de afecto)

### Cómo funciona

Grafo LangGraph de 5 nodos (ver `01` §3.5). Entradas por enunciado: texto; recorte WAV de ≤ 30 s
**solo con consentimiento** (sale del anillo de `MicTap`); **señales de interacción** con las
mismas claves en front y backend (`duration_ms`, `words_per_second`, `pause_before_ms`,
`interrupted_agent`, `repeated_question`); historial de afecto de los últimos 3 turnos. Salida:
`AffectEstimate` (sentimiento, emoción, `state_hint`, método texto/voz/fusionado, discrepancia,
pistas) y `StyleDecision` (estilo, directivas, motivo, desde qué turno).

Etiquetas: emoción ∈ alegría, tristeza, enojo, miedo, sorpresa, asco, neutral, incierta (las
**básicas de Ekman** + neutral/incierta); `state_hint` ∈ frustración, confusión, satisfacción,
prisa, interés, desconocido (estados de la tarea, más útiles para decidir el tono).

### Cómo se construyó y se auditó (16-oct, `20e78ef`)

- **Prompt `affect-v2`** (`integrations/llm/affect_models.py`): evalúa **a quien habla, no el tema**
  («¿cuántas IPS atienden cáncer?» es neutral), una corrección no es enojo, ironía = enojo o
  frustración, definiciones de cada estado, expresiones de Colombia, el enunciado es dato.
- **Cobertura (*hedging*):** si Gemini no responde en 1,6 s, OpenAI arranca **en paralelo** y gana la
  primera respuesta válida. Motivo medido: con Gemini degradado, 22 de 39 frases salían «incierta».
  La cobertura se activó en ≈ 8 % de las llamadas.
- **Fusión** corregida: una lectura incierta cuenta como ausente; 2 s de silencio ya no mandan sobre
  un texto claro.
- **Rama de voz:** recibe solo el audio (sin transcripción, para que no etiquete por las palabras) +
  prosodia medida en el servidor.
- **Privacidad:** el audio viaja en un contenedor opaco (`AudioClip`) que en las trazas de LangSmith
  solo muestra su tamaño (antes se habría serializado en base64).
- **Evaluación:** `tests/fixtures/affect_eval_cases.yaml`, **39 frases** etiquetadas a mano (cada
  emoción y estado, consultas con «cáncer», «urgencias», «mortalidad», correcciones, preferencias,
  ironía, ruido, inyección) + **10 de control**. Acierto en las tres etiquetas a la vez:
  **Gemini 32 → 36/39**, **OpenAI 28 → 37/39**; control 10/10. Detectores explícitos 49/49.
  Latencia por texto p50 ≈ 1,1 s.

**Límites honestos:** la estimación **por voz** (A-21) solo se probó con voces sintéticas, que el
modelo no distinguió (tenso vs calmado); **falta una grabación humana**. Las 39 frases las etiquetó
el equipo (sin acuerdo entre anotadores medido). La sorpresa a veces sale como alegría.

**Qué decir en 1 frase:** «El análisis de emociones combina texto y voz en un grafo con fusión
determinista; lo audité con 39 frases etiquetadas y subió de 32 a 36 con Gemini y de 28 a 37 con
OpenAI, y lo único que cambia es el tono, nunca los hechos».

**Si preguntan…**
- *¿Cómo afecta la emoción al comportamiento?* Solo vía la política de estilo (`01` §7): directo,
  cálido o didáctico, con 2 señales seguidas; la preferencia explícita manda.
- *¿Bajo qué tesis?* Adaptación del estilo al estado del usuario (computación afectiva, Picard) con
  salvaguardas: incertidumbre explícita, sin diagnóstico, preferencia del usuario por encima. La
  evaluación del **beneficio** (¿mejora la experiencia?) es trabajo futuro (B-10).
- *¿Y la confianza?* No se muestra: no está calibrada (PAIR); `confidence = null`.

---

## 6. Indicador de ánimo y brillo por emoción

### Brillo (`web/src/scripts/emotion-glow.ts`, función pura `glowFor`)

El borde del recuadro del avatar se ilumina como luz con el color de la emoción: enojo rojo,
frustración salmón, prisa naranja, sorpresa ámbar, alegría amarillo, tristeza azul, miedo violeta,
confusión lila, asco oliva. Colores separados por **ΔE2000 ≥ 15** (enojo–frustración 26) para que se
distingan. «Interés» no enciende nada; con discrepancia texto/voz manda el texto.

### Indicador de ánimo (`web/src/scripts/mood-indicator.ts`, `MoodIndicator.astro`)

Como **el color solo no basta** (WCAG 1.4.1), una pastilla con un punto del mismo color y una frase
en lenguaje llano y con matiz («Te noto con prisa»): **«¿Por qué?»** (de dónde sale: palabras, voz,
pistas, discrepancia, estilo con que responde), **«No es así»** (oculta esa lectura y devuelve la
cara a neutral) y **«Ocultar el ánimo»**. Sin porcentajes de confianza, sin adjetivos con género,
nunca un diagnóstico.

**Principios aplicados:** NN/g (lenguaje llano, visibilidad del estado), **Microsoft HAX** (G2 dejar
claro qué tan bien puede hacerlo, G8 descartar fácil, G9 corregir fácil, G11 explicar por qué, G17
control global), **Google PAIR** («Explainability + Trust»: no mostrar confianza no calibrada),
**WCAG 1.4.1**, **AI Act art. 50(3)** (informar del reconocimiento de emociones).

En `/admin` hay una **leyenda de luces y caras** con «Probar» para ver cada lectura en vivo.

**Qué decir en 1 frase:** «La emoción estimada se ve en el cuerpo del avatar y en el borde, y se dice
con palabras matizadas que la persona puede cuestionar, corregir o apagar».

**Si preguntan…** *¿No confunde al usuario?* El compañero opinó que sí, para adultos mayores, y
propuso dejarlo solo en `/admin`: está en el trabajo futuro (el asesor pidió no aplicarlo aún).

---

## 7. Avatares — **qué es propio y qué es librería**

Esto hay que decirlo con precisión.

| Avatar | Qué es propio (código del proyecto) | Qué es de terceros |
|---|---|---|
| **Slime rosado** (`web/src/avatar/slime.ts`, ≈ 2.700 líneas) | **Todo el personaje**: geometría procedural (sin archivo de modelo), materiales, ojos, boca con visemas, física de resortes de gelatina (`SPRING_K = 95`, rebotes), estados corporales, nueve caras, gestos (tocar, sobar, mantener = derretirse, arrastrar), baba, modo juego, entrada «comerse el orbe» | **three.js** (motor 3D WebGL, MIT) |
| **Slime gato** (`cat.ts`) | Orejas, cola, rayas atigradas, nariz, bigotes, boca «ω», lenguaje corporal de orejas y cola | three.js |
| **Avatar 3D humano** (`human.ts`) | **Animación procedural propia**: respiración, balanceo, parpadeo, mirada, saludo, expresiones por estado, lip-sync | **Modelo `AvatarSample_C` de pixiv/VRoid** (licencia de pixiv, no CC0: uso y redistribución gratis sin crédito; prohibido declararlo CC0, cobrar por él o usarlo en un servicio de creación de personajes; ver `web/public/avatars/LICENSE.md`) cargado con **`@pixiv/three-vrm`** (MIT) sobre three.js |
| **Orbe** (`web/src/scripts/orb.ts`) | **Todo**: canvas 2D con anillo de barras radiales que cambia con el estado y pulsa con cada transcripción | Nada |

### Piezas propias compartidas

- **Lip-sync** (`lipsync.ts`): un `AnalyserNode` de Web Audio sobre la salida. Mide energía en tres
  bandas de formantes —**150–550 Hz** (vocales cerradas u/o), **600–1.400 Hz** (a), **1.700–3.600 Hz**
  (e/i)—, compara cada banda con **su propia media móvil** (porque la voz siempre tiene más energía en
  graves) y elige qué vocal destaca; ganancia adaptativa para que una voz baja abra la boca igual.
  Salida: pesos suavizados de **cinco vocales** (aa, ih, ou, ee, oh) que mueven la boca del slime o
  los *blendshapes* del VRM. Funciona con **cualquier** voz (motor o clonada) y cualquier idioma.
- **Expresión** (`expression.ts`, función pura con pruebas): de la última lectura de afecto y el
  estilo → una de 9 caras (`neutral`, `happy`, `joyful`, `calm`, `focused`, `surprised`,
  `concerned`, `sad`, `confused`). El estado manda cuando debe (dormido sigue dormido; mientras
  habla, los visemas mandan en la boca y la expresión queda en los ojos).
- **Gestos** (`gestures.ts`, pura): reconoce tocar, mantener 0,8 s, sobar (vaivenes) y arrastrar, con
  distancias proporcionales al tamaño del cuerpo en pantalla.
- **Física del modo juego** (`physics.ts`, pura): cuerpo blando en el marco visible, paredes como
  resortes con amortiguación (el hundimiento se lee como aplastamiento), gravedad desde la
  inclinación del teléfono.
- **Baba** (`goo.ts`): canvas 2D bajo el 3D, trazos translúcidos que se desvanecen en ≈ 6,5 s.
- **Contrato** (`types.ts`, `AvatarHandle`): `setState`, `setMouthLevel`, `attachAnalyser`,
  `setExpression`, `setPlayMode`, `setTilt`… Un personaje nuevo = otro módulo que devuelva un
  `AvatarHandle`.

### Por qué un slime (y no solo el humano)

`slime.ts` lo explica: una criatura redonda y calmada con una cara grande y legible es más fácil de
leer de un vistazo y de confiar que un humano realista, sobre todo para personas no acostumbradas a
hablar con una pantalla, y **evita el valle inquietante**. Su **lenguaje corporal es interfaz**:
dormido = espera, se inclina = te escucha, mira de lado con tres puntos = consulta, rebota = habla,
se desinfla = falló. Además pesa 24 KB frente a 13 MB del VRM.

### Cómo se llegó aquí (alternativas)

- **Ready Player Me** era el candidato inicial: **cerró el 31-ene-2026** (`docs/anexos/us2-avatar-3d.md`).
- Visemas del proveedor de TTS (Azure los emite en es-CO) vs análisis de audio: se eligió **análisis
  de audio** porque funciona con cualquier motor. TalkingHead (texto → fonemas) **no tiene español**.
- Avatar con el rostro del equipo (Avatar SDK, Avaturn): 800 USD/mes. HeyGen: video 2D, no 3D.
- D-21 metió el VRM en el MVP del hackatón; en el fork, el slime pasó a ser el personaje por defecto.

**Qué decir en 1 frase:** «El slime, el gato y el orbe son código propio y procedural sobre three.js
—sin archivo de modelo—, con física, gestos, caras y lip-sync propios; el avatar humano es un modelo
VRM de muestra de VRoid, animado proceduralmente por mí con la librería three-vrm».

**Si preguntan…**
- *¿Por qué no visemas del TTS?* OpenAI y Gemini no los emiten; Cartesia da marcas por palabra, no
  visemas. El análisis espectral sirve para todos.
- *¿Lo evaluaste con adultos mayores?* No todavía: es la hipótesis de diseño; evaluarlo es trabajo futuro.

---

## 8. Temas, recorrido de ayuda y modo juego

- **Temas por avatar** (`theme.ts`, `tokens.css`): `rosa`, `gato`, `humano`; roles de color al
  estilo Material Design 3; al elegir personaje la paleta se abre en círculo desde el escenario con
  la **View Transitions API** (≈ 0,6 s; instantánea con movimiento reducido); se aplica antes del
  primer pintado. Contraste AA medido en 150 pares. Entre páginas, el `ClientRouter` de Astro usa
  View Transitions para navegar sin recargar.
- **Recorrido de ayuda** (`help-tour.ts`, `HelpTour.astro`): **implementación propia** (no es
  driver.js, aunque el compañero lo creyó): capa atenuada con un recorte que se desliza a cada
  bloque y una tarjeta (hoja inferior en el teléfono); se abre la primera vez (`ips.tour.v1`) y desde
  «¿Cómo funciona?»; pasos por página; respeta movimiento reducido.
- **Modo juego** (`play-mode.ts`): pantalla completa (o pseudo pantalla completa en iPhone),
  permiso del sensor pedido dentro del gesto en iOS, `deviceorientation` → gravedad con filtro paso
  bajo y zona muerta, `devicemotion` → sacudida que lanza al slime, `navigator.vibrate` proporcional
  al golpe en Android, barra con «Salir del juego» y «Hablar». La conversación sigue funcionando.

**Qué decir en 1 frase:** «El modo juego usa los sensores del teléfono como entrada y la vibración
como salida: es multimodalidad física, no solo voz».

**Si preguntan…** *¿Para qué un modo juego?* Hipótesis: el juego reduce la ansiedad ante la
tecnología y crea vínculo con el agente. El compañero pidió una tesis que lo respalde: hoy **no hay
evaluación**; es trabajo futuro (y el asesor pidió no quitarlo aún).

---

## 9. SDD: desarrollo guiado por especificaciones

**Spec-Driven Development**: el contrato se escribe **antes** que el código (R-30). En el hackatón:

1. **Puerta 0 (10:50–11:10):** `docs/07` (spec: requisitos F-xx, NF-xx, escenarios A-01…A-26,
   métricas y guion), `08` (contrato de voz), `09` (datos), `10` (afecto y recuperación) y `12`
   (cómo trabajar de a dos) aprobados por ambos y fusionados a `main`.
2. Spikes G1 (despliegue), G2 (voz), G3 (datos y analista) para verificar lo marcado «verificar en G2».
3. Código en dos carriles contra *mocks*; Puerta 1 a las 12:15; congelamiento a las 14:30.

**Trazabilidad:** reglas `R-01…R-31` (p. ej. R-22 evidencia primero, R-24 un turno una voz, R-26
afecto con honestidad), decisiones `D-01…D-23` con motivo, fecha y qué reemplazan, escenarios `A-xx`
mapeados a requisitos y a la rúbrica. El código y los commits citan los códigos.

**Por qué funcionó con IA:** las sesiones de Claude **no comparten memoria**; lo que las sincroniza
son los contratos versionados (`docs/08`, `docs/09`, `src/models/`, `web/src/voice/types.ts`).

**Qué decir en 1 frase:** «Escribimos los contratos antes que el código y les pusimos código a
cada regla y decisión; así dos personas y varias sesiones de IA trabajaban en paralelo sin pisarse».

**Si preguntan…** *¿No es burocracia para 6 horas?* La única puerta formal era el contrato; el
resto, ligero. Los contratos fueron la memoria compartida de agentes que no se hablan.

---

## 10. Trabajo con varios agentes de IA en paralelo

| Herramienta | Uso |
|---|---|
| **Claude Code** (Anthropic) | La mayor parte del backend, scripts, pruebas, contratos y buena parte del front, a partir de los requisitos y decisiones del equipo (README, «Uso de IA»). En el fork, varios agentes en paralelo con roles: **front**, **QA**, **investigación**, **documentación** (este paquete lo escribió un agente de documentación). |
| **GPT** (OpenAI) | El paquete de planeación inicial `sdd_ips` (insumo de `docs/07–13`, retirado con D-23). |
| Skill `frontend-design` | Dirección visual del panel y del avatar |
| Skill `superpowers` | Flujo brainstorm → plan → ejecución |
| **MCP de Playwright** | Que el agente maneje un navegador real para QA visual (capturas, móvil emulado) |
| MCP Context7 · Azure MCP | Documentación de librerías al día · consultar Azure (registrados en `docs/06`) |
| Plugin `security-guidance` | Hooks en segundo plano que avisan de secretos |

**El rol humano:** definir alcance y decisiones, dirigir y revisar, **probar en vivo** y medir. Las
cifras citadas salen de llamadas reales, registradas en `docs/anexos/`.

**Qué decir en 1 frase:** «Trabajé como director de un equipo de agentes: cada uno con su carril,
sincronizados por contratos, y yo decidiendo, revisando y probando en vivo».

**Si preguntan…** ver en `05` la pregunta difícil «¿qué hiciste tú y qué la IA?».

---

## 11. Pruebas

Ejecutadas hoy (2026-10-18) en la rama `feat/presentacion`:

| Suite | Comando | Resultado |
|---|---|---|
| Backend (pytest, sin red ni claves) | `pytest` | **166 pasan, 1 falla, 9 saltadas** (las 9 son sondas en vivo `tests/live/`, solo con `KOGNIA_LIVE=1`). La que falla, `test_stale_cache_only_when_the_source_fails`, depende de que el reloj avance entre dos llamadas; en Windows `time.monotonic()` tiene resolución gruesa y la entrada sigue «fresca»: **es un problema de la prueba en Windows, no del producto** (verificar en Linux/CI). |
| Front: contrato (vitest) | `cd web && npm test` | **413 pruebas en 24 archivos, todas pasan** (orden de `seq`, `delivered_text` tras interrumpir, eventos tardíos descartados, idempotencia, conmutación de motor, filtro de ruido, regla de 1 s en Gemini, física, gestos, expresión, brillo, ánimo, tema, modo juego…) |
| Front: navegador (Playwright, Edge, micrófono falso, motor simulado) | `cd web && npm run test:e2e` | **70 pruebas en 4 archivos. No ejecutadas hoy.** El último registro local (16-oct 17:16) terminó con 57 fallos por tiempo de espera buscando controles (p. ej. `#btn-direct`), probablemente selectores desalineados tras mover controles a `/admin`. Ver `07`. |
| Fuera de la suite | `scripts/eval_grounding.py`, `bench_models.py`, `load_evaluators.py`, `smoke_public.py` | Evidencia en `docs/anexos/` (9-oct) |

Tipos: unitarias de servicios con dobles (R-17), adaptadores con transporte simulado
(`httpx.MockTransport`), API, contrato del cliente, navegador, sondas en vivo, evaluación de grounding,
banco de latencia, concurrencia, evaluación de afecto (39 + 10 frases, de pago, manual).

**Qué decir en 1 frase:** «Casi 600 pruebas automáticas que corren sin red ni claves, más
evaluaciones con los modelos reales para lo que una prueba unitaria no puede medir: alucinaciones,
latencia, concurrencia y emociones».

---

## 12. Despliegue

Vercel Services desde el fork (`docs/11` §11): importar el repo, preset **Services**, raíz `./`,
variables (`GEMINI_API_KEY`, `SESSION_SIGNING_KEY` obligatorias; `OPENAI_API_KEY`, `CARTESIA_*`,
`VOICE_DEFAULT_ENGINE=openai` el día de la demo), *Deploy*. Verificar con `/api/health`
(`status: ok`, `default_engine`, `source.ok`). Un 500 en `/api/health` casi siempre es
`SESSION_SIGNING_KEY` ausente o corta. Simulado en local el 17-oct con un proxy que imita
`vercel.json`. Plan B: `Dockerfile`. *Instant Rollback* si un despliegue sale mal.

**Qué decir en 1 frase:** «Un solo proyecto de Vercel con dos servicios en el mismo dominio: la web
estática y la API en funciones serverless, en la misma región que la fuente de datos».
