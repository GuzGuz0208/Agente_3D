# Investigación: costos, ruido, hablante, MCP, supervisor y estado del arte

Paquete de estudio para la presentación ante el grupo de investigación en sistemas interactivos y
agentes multimodales. Consulta hecha el **2026-10-18**. Responde a lo que pidieron el asesor y el
compañero ([feedback-recibido.md](feedback-recibido.md)): reducción de costos, supresión de ruido,
reconocimiento de hablante, diferencia entre MCP y herramienta, agente supervisor, estado del arte y
marco de investigación.

**Marcas.** **[V]**: verificado hoy contra la fuente citada (página oficial, documento del proyecto o
registro bibliográfico). **[I]**: inferencia o cálculo propio a partir de datos [V], con los supuestos
explícitos. **[NC]**: no confirmado hoy. Incluye las referencias bibliográficas citadas de memoria:
existen casi con seguridad, pero hay que revisar su DOI antes de ponerlas en una diapositiva. Los números
entre corchetes `[n]` remiten a la lista de **Fuentes** del final.

**Nota de método.** Hoy no se pudo abrir directamente la página de precios de OpenAI: el entorno no
resolvía `developers.openai.com`. Sus precios salen de los resultados del buscador restringido a los
dominios oficiales de OpenAI [2][3], que coinciden con el anexo del proyecto [27]. Las páginas de Google
sí se descargaron y leyeron completas [1][4][5][6].

---

## 1. Costos y estrategia de reducción

### 1.1 Precios vigentes (USD por millón de tokens, nivel de pago)

| Modelo (uso en el proyecto) | Texto entrada | Texto en caché | Texto salida | Audio entrada | Audio en caché | Audio salida | Marca |
|---|---|---|---|---|---|---|---|
| Gemini `gemini-3.8-live` (motor por omisión) | 0,75 | — (sin precio de caché en Live) | 4,50 | 3,00 (≈ 0,005 USD/min) | — | 12,00 (≈ 0,018 USD/min) | [V] [1] |
| OpenAI `gpt-realtime-2.1` (motor 1) | 4,00 | 0,40 | 24,00 | 32,00 | 0,40 | 64,00 | [V] [2][3] |
| OpenAI `gpt-realtime-2.1-mini` | — | — | — | 10,00 | 0,30 | 20,00 | [V] [2] |
| Gemini `gemini-3.5-flash-lite` (analista; candidato a LLM de cascada) | 0,30 (texto/audio) | 0,03 | 2,50 | 0,30 | 0,03 | — | [V] [1] |
| Gemini `gemini-3.8-flash-tts` | 0,50 | — | — | — | — | 9,00 (≈ 0,0135 USD/min) | [V] [1] |

Otros precios de la cascada:

| Componente | Precio | Marca |
|---|---|---|
| Deepgram Nova-3 en streaming | 0,0048 USD/min (monolingüe) · 0,0058 USD/min (multilingüe). La página los muestra como precio «actual», frente a uno «regular» de 0,0077 y 0,0092 | [V] [7] |
| OpenAI `gpt-4o-mini-transcribe` (transcripción de la voz del usuario en el motor OpenAI) | ≈ 0,003 USD/min · `gpt-4o-transcribe` ≈ 0,006 USD/min | [V] [3] |
| Gemini `gemini-3.5-transcribe-live` | ≈ 0,009 USD/min combinados | [V] [1] |
| Google Cloud STT v2 (estándar) | 0,016 USD/min (hasta 500.000 min/mes) | [V] [5] |
| Google Cloud TTS Chirp 3 HD | 30 USD por millón de caracteres; voz personalizada instantánea: 60 USD/M | [V] [6] |
| Deepgram Aura-2 (TTS) | 0,030 USD por 1.000 caracteres | [V] [7] |
| Cartesia (voz clonada, `sonic-3.6`) | 1 crédito = 1 carácter; 750–800 créditos por minuto de audio. Pro: 5 USD/mes por 100.000 créditos; Startup: 49 USD por 1,25 M; Scale: 299 USD por 8 M | [V] [8] |

**Tokens por segundo de audio.**
- Gemini Live: ≈ 25 tokens/s, tanto de entrada como de salida [V] [4]. Concuerda con la equivalencia por
  minuto de la página de precios.
- OpenAI: su página de precios no publica la tasa. La cifra que circula (1 token por 100 ms del usuario,
  1 por 50 ms del asistente, es decir 600 y 1.200 tokens/min) cuadra con los 0,06 y 0,24 USD/min que
  OpenAI anunció en 2024 a 100 y 200 USD/M [I] [9]. Un análisis de 2026 con 4.000 sesiones afirma en
  cambio 100 tokens/s [10], así que la tasa queda **[NC]**. Por eso el cálculo de abajo da un rango, y se
  recomienda medirla con el campo `usage` de `response.done` en nuestro propio registro de latencia.

### 1.2 Por qué una sesión en tiempo real se encarece más que linealmente

- **Gemini.** La documentación oficial lo dice así [V] [4]: *«The API charges you per turn for all tokens
  present in the session context window… Past tokens are re-processed and accounted for in each new
  turn»*. El historial se guarda como **audio nativo** y se vuelve a cobrar *«at the standard audio input
  rate on every turn»*.
  - Para los modelos Live **no aparece precio de caché** [V] [1].
  - Además, en `gemini-3.8-live` el *proactive audio* está siempre activo: se cobra la entrada *«the
    entire time the Live API is listening»* [V] [4].
  - Transcribir la entrada o la salida, como hace el proyecto con `inputAudioTranscription` y
    `outputAudioTranscription` [V] [28], suma su costo al precio de salida de texto [V] [4].
- **OpenAI.** La sesión también acumula los ítems: la salida de turnos anteriores, en texto y audio, pasa
  a ser entrada de los siguientes [V] [11]. La diferencia está en el precio: ese prefijo repetido suele
  caer en **caché a 0,40 USD/M**, un 98,75 % menos que 32 USD/M. Esa caché es *best effort*, es decir, no
  está garantizada [V] [11].
- **Consecuencia.** Si cada turno vuelve a facturar todo lo anterior, en el turno *k* se pagan unos *k*
  bloques de contexto. El costo total crece entonces como **n²/2** con el número de turnos *n*, es decir,
  de forma cuadrática con la duración [I].
- **Lo que tenemos configurado (último commit).** `gemini_session.py` activa `contextWindowCompression:
  {slidingWindow: {}}` sin parámetros [V] [28]. Por omisión, la compresión salta al **80 % de la ventana**
  y conserva la mitad [V] [12]. La ventana de los modelos de audio nativo es de **128.000 tokens** [V]
  [13], así que el disparo llega hacia los 102.000 tokens, unos 68 minutos de audio a 25 tokens/s.
  **En llamadas de 15 minutos o menos, esa compresión nunca se activa y no ahorra nada** [I].
- **Cambio en curso, sin commit (árbol de trabajo del 2026-10-18).** `src/config.py` añade dos cosas:
  - `VOICE_REFRESH_TURNS = 6` y `VOICE_REFRESH_TOKENS = 20000`: renovar la sesión entre turnos con el
    sobre de contexto en texto.
  - Compresión explícita de Gemini a 32.000 tokens de disparo y 16.000 de destino [V] [28].

  Con nuestros supuestos, la renovación cada 6 turnos baja **Gemini a 15 minutos de 1,56 a unos
  0,45 USD** (−71 %) y a 5 minutos de 0,23 a 0,14 USD [I]. La compresión a 32k sola no actúa antes de
  los 15 minutos (el contexto llega a unos 19.000 tokens): es una red de seguridad [I].

### 1.3 Estimación para llamadas de 1, 5 y 15 minutos

**Supuestos [I].** Un intercambio cada 20 s: 5 s habla la persona, 10 s el agente y 5 s son silencio o
latencia. Eso da 3 turnos por minuto. Además:
- Instrucciones más las 9 herramientas: unos 2.500 tokens de texto. El prompt mide 4.914 caracteres y
  `tool_specs.py` unos 5,8 KB [V] [28].
- Unos 200 tokens de evidencia de herramienta por turno y 50 tokens de texto de salida (argumentos).
- Se transcribe toda la conversación, a unos 175 tokens/min [1].
- Sin compresión, salvo donde se indica.
- OpenAI: 600 y 1.200 tokens/min de audio, con el prefijo en caché, salvo que la columna diga otra cosa.
- Cascada: Deepgram multilingüe facturado durante toda la llamada, más `gemini-3.5-flash-lite` con el
  prefijo en caché y 45 tokens de respuesta por turno, más el TTS indicado.
- El cálculo es una suma turno a turno: cada turno factura el contexto acumulado más lo nuevo. Se
  reproduce con estos supuestos.

| Duración | Gemini 3.8 Live | Gemini, todo el audio escuchado en contexto* | OpenAI 2.1 con caché | OpenAI 2.1 sin caché | OpenAI 2.1 a 100 tokens/s [NC] | OpenAI 2.1-mini | OpenAI 2.1 en solo texto + Cartesia (voz clonada) | Cascada + Cartesia (clonada) | Cascada + Gemini TTS |
|---|---|---|---|---|---|---|---|---|---|
| 1 min (3 turnos) | 0,021 | 0,028 | 0,054 | 0,107 | 0,25 | 0,024 | 0,037 | 0,026 | 0,014 |
| 5 min (15 turnos) | **0,23** | 0,36 | 0,29 | 1,35 | 1,32 | 0,14 | 0,20 | 0,13 | 0,07 |
| 15 min (45 turnos) | **1,56** | 2,73 | 0,99 | 10,1 | 4,4 | 0,52 | 0,69 | 0,40 | 0,22 |

\* Cota superior para el caso en que el *proactive audio* deje en el contexto también los silencios y el
audio de fondo [NC].

Lo que se lee en la tabla [I]:
- **Gemini, 15 minutos:** de los 1,56 USD, unos 1,4 corresponden a volver a cobrar el contexto. Si se
  facturara sin acumular, la misma llamada costaría 0,26 USD, es decir, **6 veces menos**. A los 5
  minutos la diferencia es de 2,6 veces: una llamada de 5 minutos cuesta lo mismo que unos 13 minutos
  facturados sin acumular.
- **Analista de afecto:** suma unos 0,0005 USD por turno, igual en cualquier arquitectura (0,02 USD en
  15 minutos). No cambia la comparación.
- **Gemini con compresión ajustada:** con `triggerTokens` de unos 10.000, los 15 minutos bajan de 1,56 a
  unos **0,77 USD**.

### 1.4 Contraste con la afirmación del compañero

> «Gemini es la mitad de caro que OpenAI Realtime, pero unas 10 veces más caro que un pipeline propio
> pagando solo el LLM; en 5 minutos de llamada te terminan cobrando 15».

| Parte de la afirmación | Veredicto | Números |
|---|---|---|
| «Gemini, la mitad que OpenAI» | **Parcial; depende de la duración** | Por lista y por minuto, Gemini cuesta **alrededor de una cuarta parte**: 0,005 frente a ≈ 0,019 USD/min de entrada y 0,018 frente a ≈ 0,077 de salida [I]. Por sesión, como Gemini no tiene caché, la relación Gemini/OpenAI es **0,39 en 1 min, 0,79 en 5 min y 1,57 en 15 min**: pasados unos 7–8 minutos, **Gemini sale más caro** que OpenAI con caché [I]. Si OpenAI tokeniza a 100 tokens/s [NC], Gemini sería de 3 a 12 veces más barato |
| «~10× más caro que un pipeline propio pagando solo el LLM» | **Correcta como orden de magnitud en llamadas largas; se queda corta si se compara solo con el LLM** | Gemini frente a una cascada **completa** (STT + LLM + TTS): 0,8× en 1 min, 1,7–3,3× en 5 min y **4–7×** en 15 min [I]. Frente al LLM de texto solo (0,007 USD en 5 min y 0,026 en 15): **34× y 59×** [I]. Comparar solo con el LLM omite el STT y el TTS, que en la cascada son lo más caro |
| «En 5 minutos te cobran 15» | **Coherente** | Con nuestros supuestos, 5 minutos de Gemini cuestan como unos 13 minutos facturados sin acumular [I] |

**Mensaje para la diapositiva [I].** Por minuto de lista, Gemini Live es unas 4 veces más barato que
OpenAI Realtime. Pero vuelve a cobrar todo el audio acumulado en cada turno y no tiene caché. En llamadas
largas eso invierte la ventaja, y frente a una cascada con TTS barato el sobrecosto llega a 4–7 veces en
15 minutos.

### 1.5 Estrategias de reducción, ordenadas por impacto esperado

| # | Estrategia | Ahorro estimado | Costo en experiencia | Estado en el proyecto |
|---|---|---|---|---|
| E1 | **Renovar la sesión cada N turnos sembrando un resumen en texto.** Se usa el «sobre de contexto neutral» de D-18, de unos 4.000 tokens como máximo [V] [29] | 10 s de audio son unos 250 tokens; el mismo turno en texto, unos 40, a un precio 4 veces menor (0,75 frente a 3 USD/M), así que el contexto se abarata más de 20 veces. Con N = 6: 15 min de 1,56 a ~0,45 USD [I] | Una reconexión (≈ 1 s) entre turnos, nunca en mitad de una respuesta (docs/08 §7). Hipótesis: también evita que la voz «se ofusque» en conversaciones largas, como señaló el compañero [I] | **En curso sin commit:** `VOICE_REFRESH_TURNS = 6` y `VOICE_REFRESH_TOKENS = 20000` [V] [28] |
| E2 | **Ajustar la compresión de Gemini.** Con `triggerTokens` de unos 10–12k y `targetTokens` de unos 5–6k [12] | 15 min: −50 % (1,56 → ~0,77) [I] | Pierde memoria literal del audio antiguo. La API avisa de un pico de latencia en cada compresión [12] | Último commit: valores por omisión, que no actúan en menos de ~1 h. En curso: 32k/16k, como red de seguridad por encima de E1 [V] [28] |
| E3 | **Lo mismo en OpenAI:** `truncation` con `retention_ratio` de unos 0,8 y `token_limits.post_instructions` [11] | Evita el costo explosivo cuando la caché falla (columna «sin caché») | Truncar invalida la caché del turno siguiente [11] | No está configurado |
| E4 | **Respuestas más cortas** (instrucción de concisión) | Del 20 al 40 % según un estudio de campo [10] [NC] | Ninguno: con adultos mayores conviene además | Ya pedimos respuestas breves en el prompt |
| E5 | **Modelo mini** (`gpt-realtime-2.1-mini`) | Unos 2× frente al 2.1 en la tabla | Hay que medir la calidad de las herramientas y del español | No medido |
| E6 | **Voz del motor frente a voz clonada** | En OpenAI, la clonada **abarata**: 0,69 frente a 0,99 USD en 15 min, porque deja de pagar audio de salida a 64 USD/M y sus turnos entran al contexto como texto [I] | +1 salto de red. Cartesia da primer audio a 321 ms en caliente [V] [29] | Ya implementado (D-20, D-22) |
| E7 | **Cascada (motor 3)** para preguntas largas o sesiones de más de unos 5 min | Entre 4 y 7 veces menos en 15 min [I] | Más latencia y las interrupciones se programan a mano (ver §1.6) | Diseñado como fase 2 (D-11) |
| E8 | **Límites por sesión:** tope de duración, desconexión por inactividad (el *proactive audio* cobra mientras escucha) y cuota por token de sesión | Elimina las sesiones abandonadas [10] | Mínimo | Hay límites de tasa por sesión e IP (R-28); falta el tope por inactividad |
| E9 | **Caché de resultados de herramienta** | Pequeño en dinero y grande en latencia | — | Ya existe (`fresh` 60 s, `stale` 24 h) [V] [28] |

### 1.6 Latencia y naturalidad: tiempo real frente a cascada

| | Tiempo real (Gemini Live / OpenAI Realtime) | Cascada STT → LLM → TTS |
|---|---|---|
| Primer audio útil con consulta a la fuente, medido en el proyecto | OpenAI 3,9 s p50 / 4,7 s p95; Gemini 4,2 / 6,9 s (n = 10) [V] [29] | No medido. Estimado: endpointing de 0,3–0,5 s + LLM con herramienta de ≈ 0,9 s + herramienta de 0,3–0,7 s + segunda llamada al LLM de ≈ 1 s + TTS de 0,3 s ≈ **2,8–3,5 s** [I], con mediciones parciales [V] [29] |
| Interrupciones (barge-in) | Las da el proveedor, pero el proyecto las sustituye por la regla de 1 s del navegador [V] [29] | Todas a cargo del cliente: VAD, cancelación del LLM y del TTS, y saber qué se oyó realmente (lo mismo que ya hace la voz clonada) |
| Prosodia | Nativa, conserva el tono del usuario | Depende del TTS. Se pierde el tono de entrada, salvo que se analice aparte (ya lo hace el analista) |
| Control | El motor decide el turno (excepción D-14) | El grafo decide todo, sin necesidad de excepción a R-04 |
| Costo en llamadas largas | Crece de forma cuadrática | Crece casi linealmente (caché de prefijo de texto a 0,03 USD/M) |

Como referencia humana, el hueco típico entre turnos ronda los 200 ms [NC] [44]. Ninguna de las dos
arquitecturas llega a eso cuando hay que consultar una fuente, de ahí el «déjame verificarlo» (R-29).

---

## 2. Supresión de ruido: lo que ya hay y lo que falta

### 2.1 Capas implementadas, de la captura a la interfaz [V] [28][29]

1. **Navegador:** `getUserMedia` con `echoCancellation: "all"`, `noiseSuppression: true`,
   `autoGainControl: true`, `voiceIsolation: true` y un canal (`mic-tap.ts`, `MIC_CONSTRAINTS`).
   - Si el navegador rechaza esas restricciones, se reintenta con las básicas
     (`echoCancellation: true`).
   - `"all"` existe porque, por defecto, Chrome solo cancelaba el audio que llega de una
     `RTCPeerConnection`, y el agente suena por Web Audio. El valor viene del enum de modos de
     cancelación de eco que la W3C añadió en 2025; Firefox ya tiene pruebas de plataforma para `"all"`
     y `"remote-only"` [V] [14]. La versión de Chrome en que entra («141+», según docs/08) queda [NC].
2. **Filtro paso bajo** a 7 kHz (dos biquads), antes de remuestrear a 16 o 24 kHz.
3. **Proveedor:** en OpenAI, `input_audio_noise_reduction = far_field`, pensado para micrófono de
   portátil o de sala (`near_field` es para diadema). En Gemini, `startOfSpeechSensitivity = LOW` y el
   umbral de VAD de OpenAI se subió a 0,65 porque el ruido cortaba al agente.
4. **Regla de 1 s** (`BARGE_CONFIRM_MS = 1000`): mientras el agente habla, la voz del usuario baja el
   volumen del agente al 30 %. Si dura 1 s o más, se interrumpe; si dura menos, se trata como ruido y no
   se responde nada. Medido con Gemini real: 2 de 2 ráfagas de ruido ignoradas y 5 de 6 interrupciones
   reales correctas [V] [29].
5. **Filtro de alucinaciones** (`transcript-filter.ts`): descarta transcripciones con escritura no
   latina («公主。»), frases que los reconocedores inventan sobre silencio («Gracias por ver el video»,
   «Subtítulos… Amara.org»), muletillas («mm», «eh») y textos con menos de dos letras. Las respuestas
   cortas reales («sí», «Melgar») pasan. Se apoya en un problema documentado: Whisper alucina texto
   sobre todo en pausas largas (Koenecke et al., FAccT 2024) [V] [15].

### 2.2 Por qué nada de esto quita la televisión

- La supresión de ruido del navegador y la de los proveedores atenúa ruido **estacionario o no vocal**:
  ventiladores, teclado, tráfico [I].
- Una televisión o una radio emiten **voz humana**. Para un supresor, o para un VAD, eso es exactamente
  la señal que debe conservar.
- La cancelación de eco solo resta lo que el propio dispositivo reproduce, y la TV no pasa por él.
- Separar «la voz de esta persona» de «otra voz» exige **información del hablante**: aislamiento de voz
  personalizado o verificación de hablante (§3), o un arreglo de micrófonos con *beamforming*. El
  `voiceIsolation` del navegador apunta a eso, pero no se controla y solo existe en algunas plataformas
  [I]. Es una limitación honesta para la diapositiva 17.

### 2.3 Opciones siguientes

| Opción | Qué es | Pros | Contras | Marca |
|---|---|---|---|---|
| **RNNoise** en WASM | Red recurrente híbrida DSP + RNN (Valin, 2018), de unos 85 KB | Muy ligera y madura; corre en un `AudioWorklet` | Pensada para ruido, no para voces de fondo | [NC] [16] |
| **GTCRN** en WASM/ONNX | Red ultraligera (ICASSP 2024): 23,7k parámetros y 39,6 MMAC/s según el artículo; 48,2k y 33 MMAC/s según el repositorio actual | Más calidad por cómputo que RNNoise; viable en el navegador | Sin port oficial a WASM; hay que medir la latencia añadida | [V] [17] |
| DeepFilterNet | Filtrado profundo de banda completa | Calidad alta | Más pesada para un portátil modesto | [NC] [18] |
| **Krisp** (de pago) | SDK comercial de supresión de ruido y de voces de fondo | Ataca justo el caso de la TV | Licencia y costo; dependencia cerrada | [NC] |
| Diadema con micrófono cercano + `near_field` | Hardware | La mejora más barata y efectiva | Fricción para adultos mayores | [I] |

---

## 3. Reconocimiento y verificación de hablante: por qué no se hizo y cómo se haría

### 3.1 Motivos para no implementarlo en el MVP

| Motivo | Detalle | Marca |
|---|---|---|
| Sin servicio gestionado | **Azure AI Speaker Recognition se retiró el 30-09-2025.** Las aplicaciones perdieron el acceso a la API y Microsoft no publicó un reemplazo directo; la diarización de Azure sigue funcionando | [V] [19] |
| Alternativa de pago | **Picovoice Eagle** funciona en el dispositivo. El plan gratuito se presenta como de evaluación o uso personal, y los planes comerciales parten de 500 USD/mes (Developer, anual) o del plan Foundation para startups. Además valida la licencia en línea | [V] [20] |
| Precisión en turnos cortos | Los *embeddings* abiertos como **ECAPA-TDNN** logran un EER de 0,87 % en VoxCeleb1 con audio completo [V] [21]. Con menos de 2–3 s de audio, el error crece de forma notable; hay líneas de investigación específicas para segmentos cortos [V] [22]. Las respuestas típicas de nuestro dominio («sí», «en Medellín») son de 1–2 s. La cifra exacta a 1–2 s es [NC] | [V] / [NC] |
| Dato sensible | Una huella de voz es un **dato biométrico**. En Colombia es **dato sensible** (Ley 1581 de 2012, art. 5) y su tratamiento exige autorización explícita (art. 6) [V] [23]. En la UE es categoría especial (RGPD art. 9) [NC] [24]. El proyecto ya registra el riesgo incluso para el recorte que analiza el afecto [V] [29] | [V] |
| Fricción | El enrolamiento pide grabar 10–30 s y repetir si falla. Un falso rechazo frente a una persona mayor es una barrera de acceso. Además, la app es anónima y sin cuentas, así que no hay a quién verificar | [I] |

### 3.2 Cómo se haría en una fase futura

1. **Propósito acotado.** Sería un *filtro de voz de fondo* (¿es la misma persona que empezó la
   sesión?), no autenticación. Sin enrolamiento persistente: el *embedding* se calcula de los primeros
   turnos y vive solo en la memoria de la sesión [I].
2. **En el dispositivo.** Un ECAPA o WeSpeaker en ONNX/WASM sobre el anillo de 30 s de `MicTap`, que ya
   existe. El audio no sale del navegador [I].
3. **Decisión suave.** Por debajo del umbral no se bloquea: se baja la prioridad del turno y se pregunta
   «¿me hablas a mí?». El umbral se calibra con un EER medido sobre grabaciones reales en español
   colombiano, incluidas voces mayores [I].
4. **Consentimiento explícito y separado** del de análisis de afecto, con opción de apagarlo (D-16) [I].
5. **Diarización** («quién habló cuándo») para la transcripción, que el reto pedía. Es un problema
   distinto de la verificación. Opciones: streaming de un proveedor (Deepgram) o `pyannote` fuera de
   línea [NC] [25]. Hoy la «diarización» del proyecto es por canal (usuario frente a agente), que con un
   solo micrófono y un solo usuario es suficiente [I].

---

## 4. MCP frente a herramienta (function calling)

| | **Herramienta (function calling)** | **MCP (Model Context Protocol)** |
|---|---|---|
| Qué es | Una función que el modelo puede **pedir** que se ejecute. Se declara con nombre, descripción y **JSON Schema** de parámetros dentro de la API de un proveedor concreto; la aplicación la ejecuta y devuelve el resultado | Un **protocolo abierto cliente-servidor**, presentado por Anthropic en noviembre de 2024, para que cualquier aplicación de IA descubra y use **herramientas, recursos y prompts** expuestos por servidores, por JSON-RPC sobre stdio o HTTP |
| Nivel | Un mecanismo **dentro** de una API (OpenAI Realtime, Gemini Live) | Una capa de **interoperabilidad entre** aplicaciones y proveedores |
| Quién la declara | El código de la aplicación, en cada sesión | El servidor MCP; el cliente las descubre (`tools/list`) |
| Portabilidad | Hay que traducir el esquema al formato de cada proveedor | Se escribe una vez y la usa cualquier cliente compatible |
| Gobierno | Del proveedor | Donado el 09-12-2025 a la **Agentic AI Foundation** (Linux Foundation), cofundada por Anthropic, Block y OpenAI [V] [26] |

Marca: [V] para la donación y la gobernanza [26]; [NC] para los detalles del protocolo [25b], que salen
de la especificación pública y no se volvieron a leer hoy.

**Cómo encaja el proyecto.**
- **Producto.** Las **9 herramientas** son *function calling*: `search_ips`, `get_ips_details`,
  `aggregate_ips`, `compare_ips`, `correct_context`, `verify_registration`, `area_profile`,
  `compare_areas` y `dataset_info` [V] [28].
  - El backend declara los esquemas al emitir la credencial efímera.
  - El motor de voz pide la llamada y el navegador la reenvía a `POST /tools/{nombre}`.
  - El backend valida contra una lista cerrada, construye él mismo la consulta SoQL (el modelo nunca la
    escribe, D-13) y devuelve un sobre de evidencia.
- **Podrían ser un servidor MCP.** El mismo `tool_specs.py` y el mismo ejecutor, expuestos con
  `tools/list` y `tools/call`, serían usables desde Claude Desktop, un IDE u otro agente. El
  `dataset_info` y el corte de la fuente encajarían como *resources* [I]. No se hizo porque los motores
  en tiempo real consumen *function calling* nativo y un salto MCP añadiría latencia en la ruta crítica
  [I].
- **Desarrollo.** Se usaron servidores MCP como herramientas **del asistente de programación**, no del
  producto: Playwright para pruebas de navegador, Context7 para documentación y los de Azure y
  Terraform en la fase inicial [V] (CLAUDE.md, AGENTS.md §9).

```
PRODUCTO (function calling)                         DESARROLLO (MCP)
Navegador                                           Asistente de programación (cliente MCP)
  motor de voz --tool_call{name,args}-->              |-- servidor MCP Playwright  -> navegador de pruebas
  VoiceEngine --POST /tools/{name}--> FastAPI         |-- servidor MCP Context7    -> documentación
                 <-- sobre de evidencia --            '-- (futuro) servidor MCP "ips" -> mismas 9 herramientas
  motor de voz <-- {status,data,evidence} --
```

---

## 5. Agente supervisor contra alucinaciones

### 5.1 Estado del arte, en una línea cada técnica

| Técnica | Idea | Referencia | Marca |
|---|---|---|---|
| LLM como juez | Un LLM evalúa la respuesta de otro; concuerda razonablemente con humanos, con sesgos de posición y de verbosidad | Zheng et al., NeurIPS 2023 (MT-Bench) [30] | [NC] |
| Autoconsistencia | Se muestrean varias respuestas y se queda la mayoritaria | Wang et al., ICLR 2023 [31] | [NC] |
| SelfCheckGPT | Sin acceso externo: si varias muestras se contradicen, probablemente hay alucinación | Manakul et al., EMNLP 2023 [32] | [NC] |
| Cadena de verificación (CoVe) | El modelo planea preguntas de verificación, las responde por separado y corrige | Dhuliawala et al., 2023 [33] | [NC] |
| Verificación con evidencia o herramientas | Se contrasta cada afirmación con fuentes recuperadas o herramientas (RARR, CRITIC, FActScore) | Gao et al. 2023; Gou et al., ICLR 2024; Min et al., EMNLP 2023 [34] | [NC] |
| Barandas programables | Rieles declarativos de entrada, salida y tema (NeMo Guardrails, Colang); clasificadores de seguridad (Llama Guard) | Rebedea et al., EMNLP 2023 Demo; Inan et al. 2023 [35] | [NC] |
| Crítico o constitución | Un agente crítico revisa contra principios explícitos | Bai et al. 2022 (Constitutional AI) [36] | [NC] |

### 5.2 Lo que ya hace el proyecto: un supervisor determinista de cifras

`services/ips/verify.py` (`POST /verify/answer`) extrae los números que dijo el agente y comprueba que
aparezcan en la evidencia del turno [V] [28]:
- La evidencia incluye campos numéricos y también dígitos dentro de textos: teléfonos, direcciones,
  códigos.
- Un número sin respaldo se marca como **«cifra no verificada»**. **Nunca reescribe la respuesta.**
- Corre después de hablar y fuera de la ruta crítica.
- Límites que el propio código declara: no lee números escritos en palabras e ignora los menores de 10.

**En la terminología de §5.1, es un verificador con evidencia, determinista y asíncrono.** Su ventaja es
que no puede alucinar.

Se suman otras capas de supervisión:
- **Guardrail de alcance:** el prompt y las herramientas cerradas. Si se pregunta por el clima o el
  fútbol, el agente no se sale del dominio (lo pide JS2).
- **Validación de esquema** de cada llamada.
- **Honestidad ante fallos:** si la fuente no responde a tiempo, se devuelve `unavailable` o `TIMEOUT`;
  nunca se inventa un resultado (R-25).

### 5.3 Propuesta de arquitectura del supervisor (para el proyecto macro de 2 agentes)

```
             +---------------- ruta crítica (voz) ----------------+
usuario ---> | agente interactivo (realtime) -- herramientas --> evidencia |
             +---------------------------+------------------------+
                                         | texto escuchado + evidencia del turno (asíncrono)
                                         v
             +--------- SUPERVISOR (fuera de la ruta crítica) ----------+
             | N1 determinista: cifras, entidades, fechas de corte (hoy) |
             | N2 NLI / LLM juez barato: ¿cada afirmación está respaldada?|
             |    (flash-lite, esquema JSON, plazo de 2 s)               |
             | N3 política: alcance, consejo médico, tono                |
             +---------------------------+--------------------------------+
                                         | veredicto {ok | dudoso | contradicho, afirmación, evidencia}
                                         v
     interfaz marca la cifra  ·  nota al motor para corregirse en el turno siguiente  ·  métricas y traza
```

| Modo | Cómo actúa | Latencia añadida | Pros | Contras |
|---|---|---|---|---|
| **Asíncrono, corrección posterior** (recomendado) | Revisa lo que se dijo; si contradice la evidencia, la interfaz lo marca y se envía al motor una nota de contexto: «corrige: la cifra correcta es X según…» | 0 en la respuesta; 1–2 s después | Conserva la naturalidad y la latencia; encaja con la sesión de voz | El error se oye antes de corregirse |
| **Síncrono, compuerta antes de hablar** | Con voz clonada (texto → Cartesia), se revisa cada frase antes de sintetizarla | +0,3 s (determinista) o +1–2 s (LLM juez) por frase [I] | El error no llega a oírse | Mata la conversación fluida; solo viable con el nivel determinista |
| **Híbrido** | Compuerta síncrona solo para N1 (cifras) en modo de voz clonada; N2 y N3 asíncronos | +~0 s para N1, que es determinista y tarda milisegundos [I] | Lo mejor de ambos para el dato más crítico | Más complejidad; requiere el modo de solo texto, hoy solo con OpenAI (D-22) |

Para evaluar el supervisor se mediría:
- Tasa de alucinación con y sin supervisor, sobre un banco de preguntas con respuesta dorada (el
  proyecto ya tiene «números dorados» verificados contra la fuente [V] [29]).
- Precisión y exhaustividad del juez frente a anotación humana.
- Falsos positivos que interrumpen sin necesidad.

---

## 6. Estado del arte para defender el proyecto

| Tema | Fuente y aporte en 1–2 líneas | Marca |
|---|---|---|
| Agentes conversacionales encarnados (ECA) | Cassell et al. (eds.), *Embodied Conversational Agents*, MIT Press 2000: el cuerpo y los gestos como canal conversacional [37] | [NC] |
| Agentes relacionales | Bickmore & Picard, *ACM TOCHI* 2005: estrategias relacionales para mantener la relación a largo plazo [38] | [NC] |
| Agentes para adultos mayores | Bickmore, Caruso, Clough-Gorr & Heeren, *Interacting with Computers* 17(6) 2005: agente asesor de ejercicio; 21 personas de 62–84 años durante 2 meses; aceptado, y aumentó los pasos diarios frente al control [39] | [V] |
| Robots sociales y adultos mayores | Pu, Moyle, Jones & Todorovic, *The Gerontologist* 59(1) 2019: revisión de 11 ECA; tendencia favorable en agitación, ansiedad y calidad de vida, **sin significación en el metaanálisis**; evidencia de baja calidad [40] | [V] |
| PARO | Moyle et al., *JAMDA* 18(9) 2017: ensayo aleatorizado por conglomerados en 28 residencias con 415 personas con demencia, comparado con peluche y atención habitual. La evaluación económica posterior favoreció ligeramente al peluche en agitación [41] | [V] |
| ElliQ | Hay un ensayo registrado (NCT03972787) **sin resultados revisados por pares**. Las cifras de soledad que circulan («95 %») son del fabricante o del programa de Nueva York [42] | [V] |
| Aceptación de la tecnología | Heerink et al., modelo Almere (*Int. J. Social Robotics* 2010): aceptación de agentes sociales por mayores [43] | [NC] |
| Valle inquietante | Mori 1970 (traducción de MacDorman & Kageki, *IEEE RAM* 2012). Mathur & Reichling, *Cognition* 146 (2016): reproducen la curva con 80 caras de robots reales y afecta a la confianza. Kätsyri et al., *Front. Psychol.* 2015: apoyo inconsistente a la hipótesis «ingenua» y bueno a la de **desajuste perceptivo** [45] | [V] (Mathur, Kätsyri) / [NC] (Mori) |
| Por qué un slime | Un avatar no humano y estilizado evita la zona del valle y el desajuste voz-cara de un humano casi real; es una hipótesis a probar, no un resultado [I] | [I] |
| Toma de turnos | Sacks, Schegloff & Jefferson, *Language* 1974; Stivers et al., *PNAS* 2009 (huecos de unos 200 ms en 10 idiomas) [44]. Skantze, *Computer Speech & Language* 67 (2021): revisión de toma de turnos en sistemas y HRI [46] | [V] (Skantze) / [NC] |
| VAD, endpointing, full-duplex | Raux & Eskenazi 2009 (toma de turnos con máquina de estados); Moshi (Défossez et al. 2024), diálogo full-duplex de voz a voz [47] | [NC] |
| Computación afectiva | Picard, *Affective Computing*, MIT Press 1997 [48] | [NC] |
| Críticas al reconocimiento de emociones | Barrett et al., *Psychological Science in the Public Interest* 20(1) 2019: más de 1.000 estudios; **no se puede leer la emoción de forma fiable solo de la expresión facial**, sin contexto [49]. Por eso el proyecto habla de «estimación incierta», sin diagnóstico, y prefiere la preferencia explícita (D-16) | [V] |
| Emoción multimodal | Poria et al., *Information Fusion* 2017 (revisión de afecto multimodal); MELD (ACL 2019) como corpus de diálogo [50]. El proyecto ya observó que, con transcripción, el modelo etiqueta por las palabras y no por la voz, y que con voz sintética no distingue tensa de calmada (A-21 pendiente) [V] [29] | [NC] / [V] |
| Empatía y adaptación de estilo | Brave, Nass & Hutchinson, *IJHCS* 2005 (agentes empáticos mejor valorados); Rashkin et al., ACL 2019 (EmpatheticDialogues); Teoría de la Acomodación Comunicativa (Giles) [51] | [NC] |
| Sincronización labial | Fisher 1968 (concepto de visema); Edwards et al., *JALI*, SIGGRAPH 2016 [52]. El proyecto usa sincronización **por audio**: un `AnalyserNode` elige la vocal VRM (aa/ih/ou/ee/oh) por bandas espectrales, porque ningún motor elegido emite visemas [V] [28] | [NC] / [V] |
| Voces clonadas y ética | Clonación de pocos segundos (VALL-E, Wang et al. 2023) [53]; riesgo de suplantación. El proyecto solo clona con consentimiento a una persona del equipo y avisa de que es voz sintética (D-20) [V] [29] | [NC] / [V] |
| IA de confianza | Amershi et al., CHI 2019: 18 pautas de interacción humano-IA (HAX) [54]; *People + AI Guidebook* de Google PAIR [55] | [NC] |
| AI Act (UE) | **Art. 50** (transparencia: avisar de que se habla con una IA, de que el contenido es sintético y de que se usa reconocimiento de emociones). Aplica desde el **2-08-2026**; el Ómnibus Digital solo dio prórroga al marcado del 50(2) [V] [56]. **Art. 5(1)(f)** prohíbe inferir emociones en el **trabajo y la educación**, no en nuestro caso. Ojo: el art. 3(39) define «reconocimiento de emociones» sobre **datos biométricos**, así que el análisis de la voz entra en la definición y el del texto no [V] [57]. Que esto sea alto riesgo (anexo III) es [NC] | [V] / [NC] |

---

## 7. Marco de investigación propuesto

**Objetivo general.** Diseñar y evaluar un agente social interactivo por voz, con avatar, que consulte
datos públicos de forma **verificable** y adapte su estilo al estado afectivo **estimado** del usuario.
Se mide el efecto sobre la experiencia, la confianza y la exactitud, con énfasis futuro en adultos
mayores.

**Objetivos específicos.**
1. Medir latencia, interrupciones y costo de dos arquitecturas: tiempo real frente a cascada.
2. Validar la estimación de afecto multimodal frente a etiquetas humanas.
3. Evaluar si la adaptación de estilo mejora la satisfacción y la confianza.
4. Cuantificar la reducción de alucinaciones con el supervisor.

**Preguntas de investigación.**

| # | Pregunta |
|---|---|
| PI1 | ¿Qué diferencia de latencia percibida, naturalidad y costo hay entre un motor de voz en tiempo real y una cascada STT → LLM → TTS en consultas con herramientas? |
| PI2 | ¿Mejora la fusión texto + prosodia la concordancia con etiquetas humanas frente al texto solo, en español colombiano y con voces mayores? |
| PI3 | ¿Aumenta la adaptación de estilo (directo, cálido, didáctico) la satisfacción y la confianza percibida, sin bajar la eficiencia? |
| PI4 | ¿Cuánto reduce un supervisor asíncrono, determinista y con LLM juez, la tasa de afirmaciones no respaldadas, y a qué costo de interrupciones innecesarias? |
| PI5 | ¿Cómo influye la forma del avatar (slime, humano VRM, orbe) en la aceptación y la incomodidad en adultos mayores? |

**Hipótesis [I].**
- H1: la cascada cuesta entre 4 y 7 veces menos en llamadas de 15 minutos, con no más de 1 s extra de
  latencia p50.
- H2: la fusión supera al texto solo en κ de Cohen frente a anotadores.
- H3: el estilo adaptativo sube el SUS y la confianza en al menos 0,5 desviaciones típicas.
- H4: el supervisor reduce a la mitad las cifras no respaldadas.
- H5: el avatar no humano genera menos incomodidad que el humano casi real.

**Métricas de éxito.**

| Dimensión | Métrica | Instrumento | Meta de partida |
|---|---|---|---|
| Latencia | Primer audio útil p50/p95 desde el fin de la voz; reconocimiento previo; tiempo de parada al interrumpir | HUD y `bench_models.py` (ya existen) | p95 ≤ 4,0 s; parada ≤ 200 ms (docs/07 §8) |
| Interrupciones | Interrupciones correctas, cortes falsos por ruido y voz perdida | Registro de eventos `barge_*` con anotación | ≥ 90 % correctas; ≤ 5 % cortes falsos |
| Afecto | κ de Cohen o F1 macro frente a 2–3 anotadores; tasa de `uncertain` | Corpus propio con consentimiento | κ ≥ 0,4 (moderado) |
| Experiencia | SUS (Brooke 1996) y UEQ (Laugwitz et al. 2008) [58] | Cuestionarios | SUS ≥ 68 |
| Agente social | Godspeed (Bartneck et al. 2009) y confianza (Jian et al. 2000) [58] | Cuestionarios | Comparación entre condiciones |
| Exactitud | Tasa de alucinación: cifras o entidades sin respaldo por respuesta; exactitud frente a números dorados | Verificador + revisión humana | Reducción ≥ 50 % con supervisor |
| Costo | USD por minuto y por sesión, por motor | `usage` de los proveedores | Informe por arquitectura |

**Diseño de evaluación.**
1. **Piloto de laboratorio:** 10–15 estudiantes; tareas guiadas (buscar una IPS, comparar municipios,
   preguntar fuera de tema); diseño intrasujeto con orden contrabalanceado.
2. **Estudio con adultos mayores (fase 2):**
   - Muestra: 15–25 personas de 60 años o más.
   - Sesiones cortas (≤ 15 min), acompañadas, en entorno real.
   - Condiciones: estilo adaptativo frente a neutro y slime frente a humano.
   - Al final, entrevista semiestructurada.
   - Requiere aval del comité de ética, consentimiento informado en lenguaje simple (leído en voz alta),
     derecho a retirarse y pausa ante señales de malestar.
3. **Anotación de afecto:** 2–3 anotadores ciegos a la condición, que reportan su concordancia.

**Datos: qué guardar y qué no.**

| Dato | ¿Se guarda? | Para qué | Retención | Tratamiento |
|---|---|---|---|---|
| Eventos de latencia, motor, herramienta, estado de caché | Sí | PI1, regresiones | 12 meses | Sin identificadores; id de sesión aleatorio |
| Texto escuchado y transcripción | Solo en el estudio y con consentimiento | PI2–PI4 | Hasta cerrar el análisis | Seudonimizado; sin nombres ni cédulas (la app no los pide) |
| Audio de la voz | **No por defecto** (hoy vive en memoria y se descarta [V] [29]). En el estudio, solo con consentimiento explícito y separado | Corpus de afecto | Lo mínimo; se borra tras anotar | Dato sensible (Ley 1581, art. 5; RGPD, art. 9). Cifrado; acceso restringido |
| Huella de voz o *embedding* de hablante | **No** | — | — | Fuera de alcance (§3) |
| Estimaciones de afecto | Sí, agregadas | PI2, PI3 | 12 meses | Sin diagnóstico; nunca se muestran como verdad |
| Cuestionarios | Sí | PI3, PI5 | Según el protocolo de ética | Seudonimizados |

**Telemetría.** Todo cuanto sea posible se registra como **evento técnico sin contenido**. Las trazas de
LangSmith ya excluyen el audio (`AudioClip` opaco, «<audio clip: N bytes, not traced>») [V] [29]. Se
avisa en pantalla de que se habla con una IA y de que hay análisis de emociones, y ambos pueden apagarse:
es lo mínimo que exige el AI Act art. 50 si se despliega en la UE [V] [56], y la buena práctica de HAX
[54].

---

## Fuentes

Fecha de consulta de todas las URL: **2026-10-18**, salvo que se indique otra.

1. Google AI for Developers, *Gemini Developer API pricing* (última actualización: 2026-10-16). https://ai.google.dev/gemini-api/docs/pricing
2. OpenAI, *Pricing*, entradas `gpt-realtime-2.1` y `gpt-realtime-2.1-mini` (vía buscador restringido al dominio oficial). https://developers.openai.com/api/docs/pricing
3. OpenAI, fichas de modelo: `gpt-realtime-2.1` (texto 4,00/0,40/24,00) y `gpt-4o-mini-transcribe` (≈ 0,003 USD/min). https://developers.openai.com/api/docs/models/gpt-realtime-2.1 · https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe
4. Google, *Live API — Best practices* (secciones «Pricing and billing» y «Proactive audio»; actualizada el 2026-09-15). https://ai.google.dev/gemini-api/docs/live-api/best-practices
5. Google Cloud, *Speech-to-Text pricing*. https://cloud.google.com/speech-to-text/pricing
6. Google Cloud, *Text-to-Speech pricing*. https://cloud.google.com/text-to-speech/pricing
7. Deepgram, *Pricing* (vía buscador restringido a deepgram.com). https://deepgram.com/pricing
8. Cartesia, *Pricing* (vía buscador restringido a cartesia.ai). https://www.cartesia.ai/pricing
9. OpenAI, *Introducing the Realtime API* (2024-10-01). https://openai.com/index/introducing-the-realtime-api/
10. Semianchuk, V., *OpenAI Realtime API Pricing in 2026: Real-World Data From 4,000 Measured Sessions*, HackerNoon, 2026-06-11. https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions
11. OpenAI, *Cost optimization* (Realtime: acumulación, caché, `truncation`, `retention_ratio`, `token_limits`). https://developers.openai.com/api/docs/guides/voice-latency-cost
12. Google, *Live API reference* (`ContextWindowCompressionConfig`: `triggerTokens` = 80 % por omisión; `targetTokens` = trigger/2). https://ai.google.dev/api/live
13. Google, *Live API — Capabilities* (ventana de 128k para audio nativo) y *Session management* (15 min sin compresión; conexión ≈ 10 min). https://ai.google.dev/gemini-api/docs/live-api/capabilities · https://ai.google.dev/gemini-api/docs/live-api/session-management
14. W3C WebRTC WG, propuesta de modos de cancelación de eco (2025-04) y PR «Add EchoCancellationModeEnum (#1044)»; pruebas WPT `GUM-echoCancellation-all`. https://lists.w3.org/Archives/Public/public-webrtc-logs/2025Apr/0000.html · https://searchfox.org/firefox-main/source/testing/web-platform/tests/mediacapture-streams/GUM-echoCancellation-all.https.html
15. Koenecke, A., Choi, A. S. G., Mei, K., Schellmann, H., Sloane, M. (2024). *Careless Whisper: Speech-to-Text Hallucination Harms*. ACM FAccT, 1672–1681. https://dl.acm.org/doi/10.1145/3630106.3658996
16. Valin, J.-M. (2018). *A Hybrid DSP/Deep Learning Approach to Real-Time Full-Band Speech Enhancement*. IEEE MMSP. https://arxiv.org/abs/1709.08243 [NC]
17. Rong, X. et al. (2024). *GTCRN: A Speech Enhancement Model Requiring Ultralow Computational Resources*. ICASSP 2024; repositorio oficial. https://sigport.org/node/7390 · https://github.com/Xiaobin-Rong/gtcrn
18. Schröter, H. et al. (2022). *DeepFilterNet*. ICASSP. https://arxiv.org/abs/2110.05588 [NC]
19. Microsoft, *Retirement: Azure AI Speaker Recognition* (30-09-2025) y documentación de Speech. https://mc.merill.net/message/AZ-azure-ai-speaker-recognition-retirement · https://learn.microsoft.com/en-us/azure/cognitive-services/speaker-recognition/home
20. Picovoice, *Pricing* y repositorio de Eagle. https://picovoice.ai/pricing · https://github.com/picovoice/eagle
21. Desplanques, B., Thienpondt, J., Demuynck, K. (2020). *ECAPA-TDNN*. Interspeech. https://arxiv.org/abs/2005.07143
22. *Short Segment Speaker Verification Using ECAPA-TDNN with Multi-Resolution Encoder*, ICASSP 2023; *SKA-TDNN* (resultados con 1,5 y 3 s). https://sapl.gist.ac.kr/wp-content/uploads/2023/05/Short-Segment_Speaker_Verification_Using_ECAPA-TDNN_with_Multi-Resolution_Encoder.pdf · https://arxiv.org/pdf/2204.01005
23. Congreso de Colombia, *Ley Estatutaria 1581 de 2012*, arts. 5–6. https://www.saludcapital.gov.co/Normo/gsp/ley_1581_de_2012.pdf
24. Reglamento (UE) 2016/679 (RGPD), art. 9. https://eur-lex.europa.eu/eli/reg/2016/679/oj [NC]
25. Bredin, H. (2023). *pyannote.audio 2.1 speaker diarization pipeline*. Interspeech. https://github.com/pyannote/pyannote-audio [NC]
25b. Model Context Protocol, especificación. https://modelcontextprotocol.io [NC]
26. Anthropic, *Donating the Model Context Protocol and establishing the Agentic AI Foundation* (2025-12-09). https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
27. Proyecto, `docs/anexos/us1-modelos-voz.md` (precios verificados el 20-09-2026).
28. Proyecto, código: `src/config.py`, `src/integrations/realtime/gemini_session.py`, `src/services/ips/tool_specs.py`, `src/services/ips/verify.py`, `src/services/analyst/graph.py`, `web/src/voice/audio/mic-tap.ts`, `web/src/voice/realtime-base.ts`, `web/src/voice/transcript-filter.ts`, `web/src/avatar/lipsync.ts`, `config/domains/reto01_ips.yaml`.
29. Proyecto, documentos: `docs/00-contexto-y-decisiones.md` (D-11 a D-23, mediciones G2/G3, banco de latencia), `docs/08-contrato-voz-en-vivo.md` (§4, §6, §7, §15), `docs/10-modelos-afecto-y-recuperacion.md` (§1, §3, afecto y consentimiento), `docs/11-despliegue.md` (§10).
30. Zheng, L. et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*. NeurIPS. https://arxiv.org/abs/2306.05685 [NC]
31. Wang, X. et al. (2023). *Self-Consistency Improves Chain of Thought Reasoning in Language Models*. ICLR. https://arxiv.org/abs/2203.11171 [NC]
32. Manakul, P., Liusie, A., Gales, M. (2023). *SelfCheckGPT*. EMNLP. https://arxiv.org/abs/2303.08896 [NC]
33. Dhuliawala, S. et al. (2023). *Chain-of-Verification Reduces Hallucination in LLMs*. https://arxiv.org/abs/2309.11495 [NC]
34. Gao, L. et al. (2023). *RARR*. ACL · Gou, Z. et al. (2024). *CRITIC*. ICLR · Min, S. et al. (2023). *FActScore*. EMNLP. https://arxiv.org/abs/2210.08726 · https://arxiv.org/abs/2305.11738 · https://arxiv.org/abs/2305.14251 [NC]
35. Rebedea, T. et al. (2023). *NeMo Guardrails*. EMNLP Demos · Inan, H. et al. (2023). *Llama Guard*. https://arxiv.org/abs/2310.10501 · https://arxiv.org/abs/2312.06674 [NC]
36. Bai, Y. et al. (2022). *Constitutional AI: Harmlessness from AI Feedback*. https://arxiv.org/abs/2212.08073 [NC]
37. Cassell, J., Sullivan, J., Prevost, S., Churchill, E. (eds.) (2000). *Embodied Conversational Agents*. MIT Press. [NC]
38. Bickmore, T., Picard, R. (2005). *Establishing and Maintaining Long-Term Human-Computer Relationships*. ACM TOCHI 12(2). [NC]
39. Bickmore, T., Caruso, L., Clough-Gorr, K., Heeren, T. (2005). *Interacting with Computers* 17(6), 711–735. doi:10.1016/j.intcom.2005.09.002. https://www.ccs.neu.edu/~bickmore/publications/IWC05.pdf
40. Pu, L., Moyle, W., Jones, C., Todorovic, M. (2019). *The Effectiveness of Social Robots for Older Adults*. The Gerontologist 59(1), e37–e51. doi:10.1093/geront/gny046. https://pubmed.ncbi.nlm.nih.gov/29897445/
41. Moyle, W. et al. (2017). *Use of a Robotic Seal as a Therapeutic Tool to Improve Dementia Symptoms*. JAMDA 18(9), 766–773. doi:10.1016/j.jamda.2017.03.018 · Mervin et al. (2018), evaluación económica. https://research.bond.edu.au/en/publications/the-cost-effectiveness-of-using-paro-a-therapeutic-robotic-seal-t/
42. ClinicalTrials.gov NCT03972787 (ElliQ) e Intuition Robotics (afirmaciones del fabricante). https://clinicaltrials.gov/study/NCT03972787 · https://www.intuitionrobotics.com/post/the-results-are-in---measuring-the-efficacy-of-elliq
43. Heerink, M., Kröse, B., Evers, V., Wielinga, B. (2010). *Assessing Acceptance of Assistive Social Agent Technology by Older Adults: the Almere Model*. Int. J. Social Robotics 2. [NC]
44. Sacks, H., Schegloff, E., Jefferson, G. (1974). *Language* 50(4) · Stivers, T. et al. (2009). *Universals and cultural variation in turn-taking in conversation*. PNAS 106(26). [NC]
45. Mori, M. (1970/2012). *The Uncanny Valley*, trad. MacDorman & Kageki, IEEE Robotics & Automation Magazine [NC] · Mathur, M., Reichling, D. (2016). Cognition 146, 22–32 · Kätsyri, J. et al. (2015). Front. Psychol. 6:390. https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00390/full
46. Skantze, G. (2021). *Turn-taking in Conversational Systems and Human-Robot Interaction: A Review*. Computer Speech & Language 67. https://www.kth.se/profile/skantze/page/msc-thesis-proposals
47. Raux, A., Eskenazi, M. (2009). *A Finite-State Turn-Taking Model for Spoken Dialog Systems*. NAACL · Défossez, A. et al. (2024). *Moshi*. https://arxiv.org/abs/2410.00037 [NC]
48. Picard, R. (1997). *Affective Computing*. MIT Press. [NC]
49. Barrett, L. F., Adolphs, R., Marsella, S., Martinez, A., Pollak, S. (2019). *Emotional Expressions Reconsidered*. Psychological Science in the Public Interest 20(1), 1–68. doi:10.1177/1529100619832930. https://pmc.ncbi.nlm.nih.gov/articles/PMC6640856/
50. Poria, S., Cambria, E., Bajpai, R., Hussain, A. (2017). Information Fusion 37 · Poria, S. et al. (2019). *MELD*. ACL. [NC]
51. Brave, S., Nass, C., Hutchinson, K. (2005). IJHCS 62(2) · Rashkin, H. et al. (2019). *EmpatheticDialogues*. ACL · Giles, H. *Communication Accommodation Theory*. [NC]
52. Fisher, C. G. (1968). J. Speech Hear. Res. 11 · Edwards, P. et al. (2016). *JALI*. ACM TOG/SIGGRAPH. [NC]
53. Wang, C. et al. (2023). *Neural Codec Language Models are Zero-Shot Text to Speech Synthesizers (VALL-E)*. https://arxiv.org/abs/2301.02111 [NC]
54. Amershi, S. et al. (2019). *Guidelines for Human-AI Interaction*. CHI. https://www.microsoft.com/en-us/haxtoolkit/ [NC]
55. Google PAIR, *People + AI Guidebook*. https://pair.withgoogle.com/guidebook [NC]
56. Reglamento (UE) 2024/1689 (AI Act), art. 50, y Ómnibus Digital (en vigor desde el 27-07-2026, según análisis jurídicos). https://www.joneswalker.com/en/insights/blogs/ai-law-blog/yes-august-2-still-matters-the-eu-approved-a-high-risk-ai-delay-but-most-trans.html · https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
57. Future of Privacy Forum, *Red Lines under EU AI Act: emotion recognition in the workplace and education* (arts. 5(1)(f) y 3(39)). https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/
58. Brooke, J. (1996). *SUS* · Laugwitz, B., Held, T., Schrepp, M. (2008). *UEQ* · Bartneck, C. et al. (2009). *Godspeed*. Int. J. Social Robotics 1 · Jian, J.-Y., Bisantz, A., Drury, C. (2000). *Trust in automated systems scale*. Int. J. Cognitive Ergonomics 4(1). [NC]
