# 02b · Glosario

Cada término en 2–3 líneas, con **dónde aparece en el proyecto**. Ordenado por temas; al final,
un índice alfabético rápido.

---

## A. Dominio y datos

**IPS (Institución Prestadora de Servicios de Salud).** En Colombia, cualquier prestador que atiende
pacientes: hospital, clínica, consultorio, laboratorio. Para España: «centro o proveedor sanitario».
*En el proyecto:* 9.320 IPS distintas en el REPS; no confundir con **EPS** (la aseguradora; el prompt
pide confirmar «¿IPS?» si se oye «EPS»).

**REPS.** Registro Especial de Prestadores de Servicios de Salud, del Ministerio de Salud. *En el
proyecto:* el dataset `s2ru-bqt6` de datos.gov.co, corte 5-nov-2022, licencia CC BY-SA 4.0.

**Sede / código de sede.** Un prestador puede tener varias sedes. *En el proyecto:* 10.921 códigos de
sede, que **no** son sedes físicas validadas (advertencia `SITE_CODES_NOT_PHYSICAL_SITES`); una sede
se identifica con `site_key` = prestador:sede:número.

**Capacidad instalada.** Camas, ambulancias, consultorios… **registrados**, no disponibles hoy.
*En el proyecto:* advertencia `NOT_AVAILABILITY`; el agente nunca afirma disponibilidad.

**Datos abiertos / datos.gov.co.** Portal oficial de datos abiertos de Colombia, sobre la plataforma
Socrata. *En el proyecto:* la única fuente del agente.

**Socrata / SODA / SoQL.** Socrata es la plataforma; SODA su API (v2 con GET, v3 con POST); **SoQL**
su lenguaje de consultas, parecido a SQL (`SELECT count(DISTINCT c_digo_prestador) WHERE …`).
*En el proyecto:* la SoQL la arma `src/services/ips/soql.py`; el modelo nunca la escribe.

**Grano (de un dato).** Qué representa una fila. *En el proyecto:* una fila = una categoría de
capacidad de una sede; contar filas ≠ contar IPS ≠ contar sedes.

**Léxico.** Diccionario de nombres válidos generado desde la API. *En el proyecto:*
`data/lexicon.json` normaliza «Bogota» → «Bogotá D.C», detecta homónimos (67 municipios) y distritos;
nunca da cifras.

**Licencia CC BY-SA 4.0.** Creative Commons Atribución-CompartirIgual. *En el proyecto:* obliga a
atribuir al Ministerio en la interfaz.

---

## B. Voz y audio

**Speech-to-speech (S2S) / modelo realtime.** Un único modelo que recibe audio y produce audio, sin
pasar por texto intermedio explícito. *En el proyecto:* OpenAI Realtime `gpt-realtime-2.1` y Gemini
Live `gemini-3.8-live`.

**Cascada STT → LLM → TTS.** La alternativa clásica: reconocimiento de voz, luego un LLM de texto,
luego síntesis. Más control y más barata, más latencia que orquestar. *En el proyecto:* «motor 3»,
backlog B-04; ver `03`.

**STT / ASR.** *Speech-to-Text* / *Automatic Speech Recognition*: voz → texto. *En el proyecto:* el
transcriptor de entrada (`gpt-4o-mini-transcribe` en OpenAI, `inputAudioTranscription` en Gemini).

**TTS.** *Text-to-Speech*: texto → voz. *En el proyecto:* la voz del motor o Cartesia `sonic-3.6`.

**Voz clonada.** TTS que imita la voz de una persona a partir de una muestra (≈ 10–60 s). *En el
proyecto:* voz de un integrante del equipo en Cartesia, con consentimiento; solo con OpenAI.

**VAD (Voice Activity Detection).** Detecta cuándo hay voz y cuándo silencio. *En el proyecto:*
`server_vad` de OpenAI (umbral 0,65, silencio 500 ms), detección automática de Gemini, y un VAD de
energía local en `MicTap` (inicio 40 ms, fin 300 ms).

**Endpointing (fin de turno).** Decidir que la persona terminó de hablar. Con VAD clásico, por
silencio; con *semantic VAD*, por el sentido. *En el proyecto:* 500 ms de silencio; `semantic_vad`
se midió y se descartó (más lento y variable, `docs/00` §6).

**Barge-in (interrupción).** Que la persona hable encima del agente y este se calle. *En el
proyecto:* regla de 1 s; parada local inmediata; `delivered_text` guarda solo lo oído.

**Ducking.** Bajar el volumen de una fuente cuando aparece otra. *En el proyecto:* el agente baja al
30 % mientras se confirma si la voz de la persona es una interrupción.

**Toma de turnos (turn-taking).** Cómo se reparten la palabra los interlocutores. *En el proyecto:*
la decide el motor (excepción D-14), con la regla de 1 s y la muletilla «Un momento.» antes de consultar.

**Reconocimiento previo / muletilla.** Frase corta antes de una acción lenta para bajar la latencia
percibida. *En el proyecto:* «Un momento.»; se mide aparte y no cuenta como respuesta (R-29).

**PCM16.** Audio sin comprimir, muestras enteras de 16 bits. *En el proyecto:* formato de todo el
audio: 16 kHz hacia Gemini, 24 kHz hacia OpenAI y en la reproducción.

**Frecuencia de muestreo (16 / 24 kHz).** Muestras por segundo. *En el proyecto:* `MicTap` remuestrea
al ritmo que pide cada proveedor.

**AudioWorklet.** API de Web Audio para procesar audio en un hilo dedicado, sin cortes. *En el
proyecto:* `web/public/worklets/mic-capture.js` entrega tramas de micrófono.

**Web Audio API / AnalyserNode.** API del navegador para procesar audio; el `AnalyserNode` da el
espectro (FFT) y el volumen en tiempo real. *En el proyecto:* `PcmPlayer` reproduce y el
`AnalyserNode` alimenta el lip-sync.

**getUserMedia / restricciones.** API para abrir el micrófono con opciones. *En el proyecto:*
`echoCancellation: "all"`, `noiseSuppression`, `autoGainControl`, `voiceIsolation`.

**Cancelación de eco (AEC).** Quitar del micrófono lo que suena por los altavoces. *En el proyecto:*
`"all"` cancela también el audio de Web Audio, no solo el de una llamada WebRTC.

**Supresión de ruido / reducción de ruido.** Atenuar ruido de fondo. *En el proyecto:* la del navegador
y la de OpenAI (`far_field`); más opciones en `03`.

**Alucinación del ASR.** Texto inventado por el reconocimiento sobre ruido o silencio. *En el
proyecto:* `transcript-filter.ts` descarta «Gracias por ver el video», caracteres chinos, etc.

**Diarización.** Separar quién habló cuándo. *En el proyecto:* por **rol** (persona/agente); la de
varias voces humanas está en el backlog (B-07).

**Prosodia.** Ritmo, entonación, volumen de la voz. *En el proyecto:* `services/analyst/prosody.py`
mide duración, dBFS, variación y palabras por segundo.

**dBFS.** Decibelios relativos al máximo digital (0 dBFS = máximo). *En el proyecto:* por debajo de
−50 dBFS el recorte se trata como silencio.

**Visema.** Forma visual de la boca asociada a un sonido. *En el proyecto:* cinco vocales VRM (aa, ih,
ou, ee, oh) deducidas del espectro en `lipsync.ts`.

**Formante.** Frecuencias de resonancia del tracto vocal que distinguen las vocales. *En el
proyecto:* las bandas 150–550, 600–1.400 y 1.700–3.600 Hz del lip-sync.

**Latencia / primer audio útil / p50 · p95.** Tiempo desde que la persona termina hasta el primer
audio relevante; p50 = mediana, p95 = el 95 % de los casos está por debajo. *En el proyecto:* p50 3,9 s
(OpenAI) con consulta; p95 4,7 s; meta p95 ≤ 4,0 s **no cumplida**.

**TTFA.** *Time To First Audio*: hasta el primer audio de una síntesis. *En el proyecto:* Cartesia 321 ms en caliente.

**Marcas de tiempo por palabra.** Inicio y fin de cada palabra en el audio sintetizado. *En el
proyecto:* Cartesia las da; sirven para saber qué texto se oyó antes de una interrupción.

---

## C. Web y despliegue

**WebSocket.** Conexión bidireccional persistente sobre HTTP(S). *En el proyecto:* navegador ⇄
OpenAI/Gemini y navegador ⇄ Cartesia, directos.

**WebRTC.** Protocolo de tiempo real para audio/video entre pares (suele usar UDP). *En el
proyecto:* no se usa; WebSocket sobre 443 evita redes que bloquean UDP.

**Credencial efímera.** Credencial de corta duración y alcance mínimo que emite el servidor para que
el navegador use un servicio sin conocer la clave maestra. *En el proyecto:* secreto `ek_…` de OpenAI
(un uso), token de Gemini (bloquea la configuración), token de Cartesia (600 s, solo síntesis).

**HMAC / token firmado.** Firma con clave secreta que prueba que un dato no fue alterado. *En el
proyecto:* sesión anónima = `base64(claims).base64(HMAC-SHA256)`, verificada en tiempo constante.

**CORS.** Política del navegador que limita llamadas entre orígenes distintos. *En el proyecto:* web y
API en el mismo dominio (Vercel Services) → no hace falta.

**Serverless / funciones.** Código que el proveedor ejecuta bajo demanda, sin servidor que mantener;
escala solo, con límites de duración. *En el proyecto:* FastAPI en Vercel Functions (300 s máx. en
Hobby, cuerpo 4,5 MB).

**Vercel Services.** Un proyecto de Vercel con varios servicios bajo un dominio. *En el proyecto:*
`web` en `/` y `api` en `/api` (`vercel.json`).

**Región `iad1`.** Washington D.C. (AWS us-east-1). *En el proyecto:* la misma zona que datos.gov.co.

**Límite de tasa (rate limit).** Máximo de peticiones por ventana. *En el proyecto:* 120/min por sesión,
1.500/min por IP (jurados en la misma Wi-Fi), 429 con `Retry-After`.

**Idempotencia.** Repetir una operación da el mismo resultado sin efectos extra. *En el proyecto:* la
misma llamada (`tool_call_id` + versión de estado + huella de argumentos + sesión) devuelve el mismo
sobre y no vuelve a consultar.

**Astro.** Framework web que genera HTML estático con «islas» de JS. *En el proyecto:* el front, sin
framework de UI.

**View Transitions API.** API del navegador para animar el cambio entre dos estados del DOM. *En el
proyecto:* el cambio de tema se abre en círculo desde el avatar; el `ClientRouter` de Astro navega
entre páginas sin recargar.

**WCAG / contraste AA.** Pautas de accesibilidad web; AA exige 4,5:1 en texto y 3:1 en gráficos.
**1.4.1:** el color no puede ser el único medio de transmitir información. *En el proyecto:* 150 pares
medidos; el indicador de ánimo añade texto al color.

**`prefers-reduced-motion`.** Preferencia del sistema para reducir animaciones. *En el proyecto:* sin
baba, sin entrada «comer el orbe», transiciones instantáneas.

**DeviceOrientation / DeviceMotion.** Eventos de inclinación y aceleración del teléfono. *En el
proyecto:* modo juego (gravedad y sacudida); en iOS hay que pedir permiso dentro de un gesto.

**Vibration API.** `navigator.vibrate(ms)`. *En el proyecto:* golpes del slime contra los bordes (Android).

**Permissions-Policy.** Cabecera que dice qué APIs sensibles puede usar la página. *En el proyecto:*
micrófono, sensores y pantalla completa para el propio origen.

---

## D. 3D y avatar

**WebGL.** API del navegador para gráficos 3D con la GPU. *En el proyecto:* lo usa three.js.

**three.js.** Librería JavaScript de 3D sobre WebGL (MIT). *En el proyecto:* motor sobre el que están
hechos el slime, el gato y el avatar humano. **Es librería**; los personajes son propios.

**Procedural.** Generado por código en tiempo de ejecución, no cargado de un archivo. *En el
proyecto:* geometría, movimiento y caras del slime y el gato; animación del humano.

**VRM.** Formato abierto (basado en glTF) para avatares humanoides, con esqueleto, expresiones y
metadatos de licencia. *En el proyecto:* `AvatarSample_C` de pixiv/VRoid (13 MB).

**`@pixiv/three-vrm`.** Librería (MIT) para cargar y animar VRM en three.js. *En el proyecto:* carga el
avatar humano.

**Blendshape / morph target.** Deformación predefinida de una malla (p. ej. boca en «a»). *En el
proyecto:* las cinco vocales del VRM.

**Valle inquietante (uncanny valley).** Rechazo ante lo casi humano. *En el proyecto:* argumento para
el slime.

**Física de resortes (spring-damper).** Modelo de fuerza proporcional a la distancia con
amortiguación. *En el proyecto:* el bamboleo de gelatina y los rebotes contra los bordes (`physics.ts`).

**ΔE2000 (CIEDE2000).** Medida de diferencia perceptual entre dos colores; ≥ 10–15 se distinguen
claramente. *En el proyecto:* los colores de emoción del brillo están separados por ΔE2000 ≥ 15.

---

## E. Agentes, LLM e IA

**LLM.** Modelo de lenguaje grande. *En el proyecto:* motores de voz y modelos del analista
(`gemini-3.5-flash-lite`, `gpt-5.4-mini`).

**Agente.** Sistema que, con un LLM, percibe, decide y actúa (llama herramientas) hacia un objetivo.
*En el proyecto:* el motor de voz con 9 herramientas. **Agente social:** además interactúa
socialmente (turnos, emociones, cuerpo).

**Function calling / herramienta (tool).** El LLM recibe la descripción de funciones (nombre,
descripción, JSON Schema) y puede pedir que se ejecute una, con argumentos; el resultado vuelve como
dato. *En el proyecto:* las 9 herramientas, declaradas en `tool_specs.py`, ejecutadas por `POST /tools/{nombre}`.

**MCP (Model Context Protocol).** Protocolo abierto (presentado por Anthropic en 2024) para que una
aplicación con LLM (el *host/cliente*) descubra y use **herramientas, recursos y prompts** expuestos
por un **servidor MCP** externo, por JSON-RPC. **Diferencia con «herramienta»:** una herramienta es
la *capacidad* (una función); MCP es un *estándar de empaquetado y transporte* para ofrecer
herramientas a cualquier cliente compatible. *En el proyecto:* en tiempo de ejecución **no hay MCP**
(las herramientas se declaran directamente al motor); MCP se usó **en el desarrollo** (Playwright,
Context7, Azure). Futuro: exponer las 9 herramientas como servidor MCP.

**JSON Schema.** Lenguaje para describir la forma de un JSON. *En el proyecto:* parámetros de las
herramientas; Pydantic los valida.

**Prompt de sistema / instrucciones.** Texto que fija el comportamiento del modelo. *En el proyecto:*
`config/domains/reto01_ips.yaml`, versión `reto01-ips-v10`.

**Grounding / anclaje.** Que la respuesta se apoye en evidencia concreta. *En el proyecto:* «mundo
cerrado», `for_model`, verificador.

**Alucinación.** Afirmación falsa generada con seguridad. *En el proyecto:* 0 en 20 casos trampa.

**Mundo cerrado.** Suponer que solo es verdad lo que está en la evidencia; lo demás «no se sabe».
*En el proyecto:* reglas 1–3 del prompt.

**Inyección de instrucciones (prompt injection).** Texto en los datos que intenta dar órdenes al modelo.
*En el proyecto:* los datos van marcados como «datos, no instrucciones».

**Text-to-SQL.** Que un LLM genere la consulta. *En el proyecto:* descartado (D-13).

**RAG.** *Retrieval-Augmented Generation*: recuperar documentos parecidos y dárselos al LLM. *En el
proyecto:* no se usa (las preguntas son agregados exactos); la base genérica lo tenía con pgvector.

**LangGraph.** Librería para escribir grafos de estado con nodos y aristas (parte del ecosistema
LangChain). *En el proyecto:* el analista de afecto, 5 nodos, ramas en paralelo.

**ReAct.** Patrón en el que el LLM alterna razonar y actuar en bucle. *En el proyecto:* descartado para
el analista porque el LLM controlaría el flujo (R-04).

**LLM-as-judge / supervisor.** Un modelo que evalúa la salida de otro. *En el proyecto:* propuesto como
capa 2 del verificador (JS6).

**Hedged request (cobertura).** Lanzar una segunda petición si la primera tarda, y quedarse con la
primera que responda. *En el proyecto:* analista: OpenAI arranca si Gemini no responde en 1,6 s.

**Computación afectiva.** Sistemas que reconocen o expresan emociones (Picard, 1997). *En el proyecto:*
el analista y el estilo adaptativo.

**SER (Speech Emotion Recognition).** Reconocer emociones desde la voz. *En el proyecto:* la rama
`acoustic_affect` (con un LLM multimodal); un modelo dedicado está en el backlog (B-12).

**Fusión tardía (late fusion).** Combinar decisiones de cada modalidad después de clasificar. *En el
proyecto:* `fuse.py` combina las etiquetas de texto y voz.

**Emociones básicas (Ekman).** Alegría, tristeza, enojo, miedo, sorpresa, asco. *En el proyecto:* las
etiquetas de `emotion`, más neutral e incierta.

**Calibración.** Que una confianza del 70 % acierte ~70 % de las veces. *En el proyecto:* las
confianzas no están calibradas, por eso no se muestran.

**Domain pack.** Paquete de configuración y periferia que adapta un núcleo genérico a un dominio. *En
el proyecto:* `config/domains/reto01_ips.yaml` + `services/ips/`.

**Arquitectura hexagonal (puertos y adaptadores).** El núcleo define interfaces (puertos); cada
proveedor se conecta con un adaptador. *En el proyecto:* `src/models/ports.py`, `VoiceEngine`,
`SpeechSynthesizer`.

**Doble de prueba (fake).** Implementación en memoria de un puerto para probar sin red. *En el
proyecto:* `tests/doubles/`, `FakeEngine`.

**SDD (Spec-Driven Development).** Escribir y aprobar la especificación (contratos) antes del código.
*En el proyecto:* `docs/07–13`, reglas R-xx, decisiones D-xx, puertas.

**LangSmith.** Servicio de trazas para aplicaciones con LLM. *En el proyecto:* opcional; el audio no se traza.

**AI Act (UE).** Reglamento europeo de IA. Art. 50: avisar de que se habla con una IA y marcar el
contenido sintético; art. 5.1.f: prohíbe inferir emociones en entornos laborales y educativos. *En el
proyecto:* aviso de IA, aviso de voz sintética, consentimiento.

**Ley 1581 de 2012 (Colombia).** Protección de datos personales; los datos biométricos son sensibles.
*En el proyecto:* riesgo registrado en `docs/10` §6 por el análisis de voz.

**HAX / PAIR / NN/g.** Guías de diseño de IA: *Microsoft Human-AI eXperience* (18 pautas), *Google
People + AI Research* (guía de diseño), *Nielsen Norman Group* (usabilidad). *En el proyecto:* base
del indicador de ánimo.

---

## Índice alfabético

AI Act · AnalyserNode · Arquitectura hexagonal · Astro · AudioWorklet · Barge-in · Blendshape ·
Calibración · Cancelación de eco · Capacidad instalada · Cascada STT→LLM→TTS · CC BY-SA ·
Computación afectiva · CORS · Credencial efímera · Datos abiertos · dBFS · DeviceOrientation ·
Diarización · Doble de prueba · Domain pack · Ducking · ΔE2000 · Emociones básicas · Endpointing ·
Formante · Function calling · Fusión tardía · getUserMedia · Grano · Grounding · HAX/PAIR/NN/g ·
Hedged request · HMAC · Idempotencia · Inyección de instrucciones · IPS · JSON Schema · LangGraph ·
LangSmith · Latencia p50/p95 · Léxico · Ley 1581 · Límite de tasa · LLM · LLM-as-judge · Marcas por
palabra · MCP · Mundo cerrado · PCM16 · Permissions-Policy · Procedural · Prosodia · RAG · ReAct ·
Reconocimiento previo · Región iad1 · REPS · Física de resortes · SDD · Sede · SER · Serverless ·
SoQL/SODA/Socrata · Speech-to-speech · STT/ASR · Supresión de ruido · Text-to-SQL · three.js ·
`@pixiv/three-vrm` · Toma de turnos · TTFA · TTS · VAD · Valle inquietante · Vercel Services ·
Vibration API · View Transitions · Visema · Voz clonada · VRM · WCAG · WebGL · WebRTC · WebSocket.
