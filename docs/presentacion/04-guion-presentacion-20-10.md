# 04 · Guion: 20 min de presentación + 10 min de demo

Público: grupo de investigación en **sistemas interactivos y agentes multimodales** (parte de España:
**no dicen «IPS»**). Objetivo (asesor): mostrar **de lo que eres capaz y tus conocimientos
técnicos**; el grupo valora **el proyecto, sus aportes y sus bases teóricas** más que el software.

Este guion reorganiza el derrotero de 18 diapositivas aplicando los comentarios **JS1–JS7**
(`feedback-recibido.md` §4):

| Comentario | Cómo se aplica aquí |
|---|---|
| JS1 | Diapositivas 2, 3 y 4 del derrotero fusionadas en **una apertura** (D2): «tuve la oportunidad de desarrollar un agente social interactivo; el que verán consulta puntos de atención médica en Colombia». «IPS» solo con su explicación. |
| JS2 | La demo se centra en el **avatar** y la interacción: avatares, latencia, interrupciones, **no salirse del contexto** (clima, fútbol), labios, voz clonada, métricas, emociones en vivo. |
| JS3 | D3: la fuente es **esta**, pero puede ser **cualquier** fuente de datos. |
| JS4 | D5: **arquitectura del backend, por qué y qué beneficios**. |
| JS5 | D7: multimodalidad a fondo + **estrategias adicionales** (y respaldo en `05`). |
| JS6 | D9: respuestas verificables + propuesta de **agente supervisor**. |
| JS7 | D6: **herramienta vs MCP** antes de hablar de los MCP usados. |

Además se integran: **reducción de costos**, **supresión de ruido** y **reconocimiento de voz** como
análisis y estrategia (detalle en [03-investigacion-costos-y-estado-del-arte.md](03-investigacion-costos-y-estado-del-arte.md)),
y el feedback del compañero como **«lo que aprendimos y trabajo futuro para adultos mayores»**.

Regla de oro al hablar: **frases cortas, una idea por diapositiva, cifras con su fuente**, y
«esto está medido / esto no» cuando toque.

---

## Parte 1 · Presentación (20:00)

| # | Diapositiva | Tiempo | Acumulado |
|---|---|---|---|
| 1 | Portada | 0:30 | 0:30 |
| 2 | Un agente social interactivo (apertura fusionada) | 1:30 | 2:00 |
| 3 | El caso de uso y la fuente intercambiable | 1:00 | 3:00 |
| 4 | Arquitectura general | 1:45 | 4:45 |
| 5 | El backend por dentro: por qué así | 2:00 | 6:45 |
| 6 | Herramientas vs MCP | 1:15 | 8:00 |
| 7 | Multimodalidad: qué entra, qué sale, cómo se fusiona | 2:00 | 10:00 |
| 8 | Toma de turnos, ruido y reconocimiento de voz | 1:30 | 11:30 |
| 9 | Respuestas verificables y agente supervisor | 1:30 | 13:00 |
| 10 | El cuerpo del agente: avatares, labios y voz clonada | 1:30 | 14:30 |
| 11 | Emoción y estilo adaptativo, con honestidad | 1:15 | 15:45 |
| 12 | Resultados medidos | 1:00 | 16:45 |
| 13 | Costos: cuánto cuesta hablar con un agente | 1:00 | 17:45 |
| 14 | Cómo lo construí: SDD y un equipo de agentes de IA | 0:45 | 18:30 |
| 15 | Lo que aprendimos y trabajo futuro (adultos mayores) | 1:00 | 19:30 |
| 16 | Cierre | 0:30 | 20:00 |

Si vas tarde: comprime D13 y D14 a 30 s cada una (los detalles van a preguntas).

---

### D1 · Portada — 0:30

**Título:** *Un agente social de voz con cuerpo: conversación en tiempo real sobre datos abiertos verificables*
**Viñetas:** tu nombre · pasantía · fecha · enlace a la demo (QR)
**Qué decir:** «Buenos días. Les voy a mostrar un agente social de voz que construí: escucha, habla,
se le puede interrumpir, tiene un cuerpo que reacciona a cómo te sientes, y todo lo que dice sale de
datos oficiales verificables».
**Visual:** captura del slime en la consola con el brillo encendido.

### D2 · Un agente social interactivo — 1:30  *(JS1: fusiona problema + pregunta + origen)*

**Título:** *Tuve la oportunidad de construir un agente social interactivo*
**Viñetas:**
- Hackatón de 6 h, entre dos personas (Kognia Labs, Reto 01)
- Después, en mi fork: cuerpo, emociones visibles, juego
- Pregunta: ¿puede un agente de voz ser **natural** y a la vez **verificable**?
**Qué decir:** «En un hackatón de seis horas, con un compañero, nos pidieron un agente de voz
cognitivo. Yo me encargué del front, la voz y el avatar; él del backend. Después lo seguí en mi fork y
lo convertí en un agente social: con un cuerpo, con emociones visibles y hasta un modo juego. La
pregunta que me guía es: ¿se puede tener una conversación de voz natural —rápida, interrumpible,
cálida— sin que el agente invente nada?».
**Visual:** dos columnas: «natural» (latencia, interrupción, tono, cuerpo) ↔ «verificable» (datos
oficiales, evidencia, verificador).

### D3 · El caso de uso y la fuente intercambiable — 1:00  *(JS1, JS3)*

**Título:** *Caso de uso: puntos de atención médica de Colombia*
**Viñetas:**
- Registro oficial del Ministerio de Salud (REPS), datos abiertos
- 9.320 prestadores («IPS»: hospitales, clínicas, consultorios) · corte 2022
- Consulta **en vivo**, sin copia ni base de datos
- **La fuente es intercambiable**
**Qué decir:** «El agente responde sobre los puntos de atención médica de Colombia: hospitales,
clínicas, consultorios; allí se llaman IPS, instituciones prestadoras de salud. Usa el registro
oficial del Ministerio, que es un dato abierto, y lo consulta en vivo en cada pregunta. Pero esto es
el caso de esta demo: la arquitectura sirve para **cualquier** fuente de datos estructurada; cambiar
de fuente es cambiar las herramientas, no el agente».
**Visual:** logo de datos.gov.co + tres cifras (9.320 · 10.921 sedes · 97.036 camas) + un recuadro
«otra API aquí».

### D4 · Arquitectura general — 1:45

**Título:** *El audio no pasa por mi servidor*
**Viñetas:**
- Navegador ⇄ motor de voz: WebSocket directo, credencial efímera
- Backend: solo HTTP, sin estado, sin base de datos
- Dos motores intercambiables: OpenAI Realtime · Gemini Live
- Voz clonada opcional: Cartesia
**Qué decir:** «El navegador habla directamente con el motor de voz, con una credencial que dura
minutos y que emite mi backend; la clave maestra nunca llega al navegador. El backend no toca el
audio: solo emite credenciales, ejecuta herramientas sobre los datos, analiza emociones y verifica
cifras. Detrás de un contrato de eventos neutrales hay dos motores, OpenAI y Gemini, que puedo
cambiar en vivo».
**Visual:** el diagrama de `01` §3.1 simplificado a 5 cajas.

### D5 · El backend por dentro: por qué así — 2:00  *(JS4)*

**Título:** *Un backend deliberadamente aburrido*
**Viñetas:**
- 9 endpoints HTTP · 9 herramientas tipadas
- El modelo elige la herramienta; **el servidor arma la consulta**
- Puertos y adaptadores: cambiar proveedor = un adaptador
- Sin estado → escala solo · privacidad por diseño
**Qué decir:** «Tres decisiones. Primera: sin estado y sin base de datos; el estado de la
conversación vive en el navegador y viaja con cada llamada, así cualquier instancia serverless atiende
cualquier petición; lo probamos con ocho evaluadores a la vez sin una sola fuga. Segunda: el modelo
nunca escribe la consulta; elige una de nueve herramientas y manda argumentos tipados; el servidor
valida contra listas cerradas, arma la consulta, decide qué se cuenta —no es lo mismo contar filas que
prestadores— y devuelve evidencia. Tercera: arquitectura hexagonal; ningún tipo de un proveedor cruza
la frontera de integraciones. Por eso tengo dos motores de voz y dos modelos de análisis
intercambiables. Y el análisis de emociones es un grafo de LangGraph de cinco nodos donde el LLM solo
pone etiquetas: el flujo es código».
**Visual:** columnas `api/ → services/ → integrations/` con `models/` transversal; al lado, el grafo
`prepare → texto ∥ voz → fuse → style_policy`.

### D6 · Herramientas vs MCP — 1:15  *(JS7)*

**Título:** *Herramienta ≠ MCP*
**Viñetas:**
- **Herramienta:** una función que el modelo puede pedir (nombre + esquema)
- **MCP:** un estándar para *ofrecer* herramientas a cualquier agente
- En ejecución: 9 herramientas declaradas al motor, **sin MCP**
- En el desarrollo: MCP de Playwright, Context7
- Futuro: las 9 herramientas como servidor MCP
**Qué decir:** «Antes de hablar de MCP, una distinción. Una herramienta es una capacidad: una función
con nombre, descripción y esquema que el modelo puede pedir que ejecute; el resultado vuelve como
dato. MCP, Model Context Protocol, es un protocolo abierto para empaquetar y ofrecer herramientas,
recursos y prompts desde un servidor a cualquier cliente compatible. Mi agente, en ejecución, usa
herramientas declaradas directamente al motor de voz: no necesita MCP. Donde sí usé MCP fue en el
desarrollo: el agente de programación manejaba un navegador real con el MCP de Playwright para hacer
QA visual, y consultaba documentación con Context7. Un paso natural sería publicar estas nueve
herramientas como servidor MCP, para que cualquier asistente pueda consultar el registro con las
mismas garantías».
**Visual:** dos diagramas: «Motor → función → backend» vs «Cliente MCP ⇄ JSON-RPC ⇄ Servidor MCP (herramientas, recursos, prompts)».

### D7 · Multimodalidad — 2:00  *(JS5)*

**Título:** *Qué entra, qué sale y cómo se fusiona*
**Viñetas:**
- Entra: voz · texto · señales de interacción · tacto · inclinación del teléfono
- Sale: voz (motor o clonada) · cuerpo y cara · labios · luz · texto · vibración
- Afecto: texto ∥ voz → fusión determinista → estilo
- La emoción cambia el **tono**, nunca los hechos
**Qué decir:** «Entradas: la voz, que se analiza dos veces —qué se dijo y cómo se dijo—, el texto,
señales de interacción como la velocidad, las pausas o si interrumpió al agente, el tacto sobre el
avatar y la inclinación del teléfono en el modo juego. Salidas: la voz, el cuerpo del avatar con nueve
caras y estados, labios sincronizados, una luz de color en el borde, el texto con evidencia y la
vibración. Las dos estimaciones de afecto, por texto y por voz, se fusionan con una regla
determinista: si discrepan se marca y se muestran ambas. Y la emoción solo cambia el estilo —más
directo, más cálido, más didáctico—, nunca los hechos». Si hay tiempo: «Estrategias adicionales que
tengo pensadas: expresión facial con cámara, un modelo dedicado de emoción en la voz, detección de fin
de turno semántica y diarización de varias personas» (detalle en `05`, sección multimodalidad).
**Visual:** tabla de dos columnas (entradas/salidas) con iconos; abajo el mini grafo de fusión.

### D8 · Toma de turnos, ruido y reconocimiento de voz — 1:30

**Título:** *Que el ruido no corte, que una pregunta sí*
**Viñetas:**
- Regla de 1 s: baja el volumen al 30 %, corta si la voz dura ≥ 1 s
- Cancelación de eco, aislamiento de voz, reducción de ruido
- Filtro de transcripciones fantasma («Gracias por ver el video»)
- Muletilla «Un momento.» antes de consultar
- Sin reconocimiento de hablante, a propósito (ver investigación)
**Qué decir:** «En un sitio real, cualquier ruido cortaba al agente. Diseñé una regla de un segundo:
cuando detecto voz mientras el agente habla, le bajo el volumen; si la voz dura un segundo es una
interrupción y lo corto, si no, era ruido y sigue. En Gemini tuve que hacerlo yo en el navegador,
con mi propio detector de voz, cortando el turno y reenviando el audio que el servidor no oyó. Además,
los reconocedores inventan frases sobre el ruido —"gracias por ver el video", caracteres chinos—, así
que las filtro. Y para la latencia percibida, el agente dice "un momento" antes de consultar. Lo que
nada de esto resuelve es una televisión o una segunda persona hablando cerca; para eso, supresión de
ruido neuronal y reconocimiento del hablante, que no implementé a propósito: no hay servicio gestionado
—Azure retiró el suyo—, falla con turnos de uno o dos segundos y una huella de voz es un dato
biométrico sensible. Cómo lo haría, en mi documento de investigación». (Enlaza `03` §2 y §3.)
**Visual:** línea de tiempo: voz del usuario → *duck* 30 % → 1 s → corte; y una lista de frases fantasma tachadas.

### D9 · Respuestas verificables y agente supervisor — 1:30  *(JS6)*

**Título:** *Tres barreras contra la alucinación*
**Viñetas:**
- 1 · Prompt de mundo cerrado
- 2 · El modelo recibe un texto exacto con las cifras (`for_model`)
- 3 · Verificador: cada cifra dicha debe estar en la evidencia
- Si no: el agente se corrige en voz alta
- **0 alucinaciones en 20 casos trampa**
- Propuesta: supervisor LLM para lo que no es una cifra
**Qué decir:** «Primera barrera, el prompt: el agente solo sabe lo que devuelve una herramienta.
Segunda: no le doy al modelo filas crudas, le doy un texto exacto con la cifra, la unidad, el corte y
"lo que no aparece aquí no se sabe". Tercera: cuando termina de hablar, un verificador sin LLM
compara cada cifra con la evidencia; si una no cuadra, el agente recibe una nota y se corrige en voz
alta. En una evaluación con veinte casos trampa contra el motor real: cero alucinaciones. En el
proyecto macro del grupo piensan en dos agentes, uno que conversa y otro que supervisa; mi verificador
ya es un supervisor, determinista y barato, para cifras. Propongo una segunda capa: un supervisor LLM,
fuera de la ruta crítica, solo para lo que las reglas no pueden juzgar —nombres, "está o no está
registrada", consejos médicos—. Lo verificable con reglas, con reglas; lo demás, con un juez».
**Visual:** embudo de 3 capas + la frase «Perdón, me corrijo: …».

### D10 · El cuerpo del agente — 1:30

**Título:** *Un cuerpo que comunica el estado*
**Viñetas:**
- Slime y gato: **procedurales, código propio** sobre three.js
- Avatar humano: modelo VRoid + animación propia
- Labios desde el espectro del audio (cinco vocales)
- Voz clonada con Cartesia (con consentimiento)
**Qué decir:** «El personaje por defecto es un slime: lo hice yo, procedural, sin archivo de modelo,
con física de resortes, gestos, nueve caras y lenguaje corporal: duerme mientras conecta, se inclina
cuando escucha, mira de lado cuando consulta, rebota cuando habla. Elegí una criatura y no un humano
porque se lee de un vistazo y evita el valle inquietante, pensando en adultos mayores. También hay un
avatar humano: el modelo es una muestra de VRoid y la animación es mía. Los labios los muevo
analizando el espectro del audio en tres bandas de formantes, así funciona con cualquier voz. Y con
OpenAI, la voz es una voz clonada del equipo, con consentimiento y aviso de voz sintética».
**Visual:** cuatro miniaturas: slime, gato, humano, orbe; etiqueta «propio» / «librería» en cada una.

### D11 · Emoción y estilo adaptativo, con honestidad — 1:15

**Título:** *Estimar sin diagnosticar*
**Viñetas:**
- 39 frases etiquetadas: Gemini 32 → 36 · OpenAI 28 → 37
- Indicador de ánimo: «Te noto con prisa» · ¿Por qué? · No es así · Ocultar
- Sin porcentajes no calibrados · consentimiento para la voz
- Pendiente: validar la voz con humanos
**Qué decir:** «Audité el análisis de emociones con 39 frases etiquetadas a mano: el acierto en las
tres etiquetas subió de 32 a 36 con Gemini y de 28 a 37 con OpenAI. Lo muestro con principios de
diseño de IA de Microsoft, Google y Nielsen Norman: el color no basta, así que hay una frase matizada,
se puede preguntar por qué, decir "no es así" o apagarlo; nunca muestro una confianza que no está
calibrada. Y soy honesto con el límite: la rama de voz solo la probé con voces sintéticas; falta
validarla con voces humanas. En Europa, el AI Act prohíbe inferir emociones en trabajo y educación,
así que esto exige consentimiento y transparencia».
**Visual:** la pastilla de ánimo + la tabla de 39 frases.

### D12 · Resultados medidos — 1:00

**Título:** *Lo que medí (y lo que no se cumple)*
**Viñetas:**
- Primer audio útil con consulta: p50 **3,9 s** (antes 9,0)
- p95 4,7 s: **meta de 4,0 s no cumplida**
- 0 alucinaciones en 20 casos · 8 usuarios simultáneos sin fugas
- ≈ 600 pruebas automáticas sin red ni claves
**Qué decir:** «Bajé el primer audio útil con consulta de nueve a menos de cuatro segundos de mediana
con muletilla corta, precarga y respuesta en una frase; pero el percentil 95 sigue en 4,7 s y mi meta
era 4: no se cumple, y lo digo. Cero alucinaciones en veinte casos trampa, ocho evaluadores a la vez
sin mezclar conversaciones, y unas seiscientas pruebas automáticas».
**Visual:** barras antes/después de latencia (OpenAI 9,0 → 3,9; Gemini 13,4 → 4,2) con la línea de meta.

### D13 · Costos — 1:00

**Título:** *Cuánto cuesta hablar con un agente*
**Viñetas** (cifras de `03` §1.3–§1.5, estimaciones con supuestos explícitos):
- Los modelos realtime vuelven a cobrar el contexto acumulado en cada turno
- Por minuto de lista, Gemini Live ≈ ¼ de OpenAI; sin caché, pasa a ser **más caro** hacia los 7–8 min
- Cascada propia STT → LLM → TTS: 4–7× más barata en 15 min
- E1: renovar la sesión cada N turnos con un resumen en texto (15 min de Gemini: 1,56 → ~0,45 USD)
- Con OpenAI, la voz clonada **abarata** (no se paga audio de salida)
**Qué decir:** «Un punto que me señaló mi compañero y que el asesor considera clave: los modelos de voz
en tiempo real acumulan el contexto y lo cobran otra vez en cada turno, así que el costo crece más que
linealmente con la duración. Lo estimé: por minuto, Gemini es unas cuatro veces más barato que OpenAI,
pero como no tiene caché, hacia los siete u ocho minutos se vuelve más caro. La estrategia de mayor
impacto es renovar la sesión cada pocos turnos con un resumen en texto, que además estabiliza la voz;
y para conversaciones largas, una cascada propia». (Las cifras salen de `03`: **no improvises otras**;
son estimaciones, dilo.)
**Visual:** curva de costo acumulado vs duración (1, 5, 15 min) para Gemini Live, OpenAI con caché y
cascada, de la tabla de `03` §1.3.

### D14 · Cómo lo construí — 0:45

**Título:** *Contratos primero, un equipo de agentes*
**Viñetas:**
- SDD: contratos `docs/07–13`, reglas R-xx, decisiones D-xx
- Varios agentes de Claude Code en paralelo: front, QA, investigación, documentación
- Yo: decidir, revisar, probar en vivo, medir
**Qué decir:** «Trabajé con desarrollo guiado por especificaciones: el contrato antes que el código,
cada regla y decisión con un código rastreable. Eso permitió que dos personas y varios agentes de IA
trabajaran en paralelo sin compartir memoria: los contratos eran la memoria. Mi papel fue decidir,
revisar, probar en vivo y medir».
**Visual:** captura de la tabla de decisiones D-xx + un esquema de agentes por carril.

### D15 · Lo que aprendimos y trabajo futuro (adultos mayores) — 1:00

**Título:** *Lo que aprendimos: hacia adultos mayores*
**Viñetas:**
- Etiquetas en todos los iconos; textos más grandes
- 1–2 botones: hablar, parar
- El agente como protagonista (globo de diálogo, sin chat)
- Ánimo solo en la vista de administración
- Dos demos: usuario y administrador con conversaciones guardadas
- Evaluar con usuarios: ¿el cuerpo y el juego ayudan?
**Qué decir:** «Mi compañero revisó la interfaz pensando en adultos mayores y tiene razón en varias
cosas: hoy hay demasiadas opciones al entrar, hay iconos sin etiqueta, y el ánimo podría confundir al
usuario final. La siguiente versión pone al agente en el centro con un globo de diálogo, deja uno o dos
botones, lleva el ánimo a la vista de administración y separa dos demos: la del usuario y la del
administrador, con conversaciones guardadas y métricas. Y lo más importante para un grupo de
investigación: evaluarlo con usuarios reales». Opcional: «Otra observación suya fue que en
conversaciones largas la voz del motor se degrada; por eso la sesión se renueva cada pocos turnos»
(solo si quedó implementado y probado; ver `07`).
**Visual:** el boceto del compañero (slime al centro, globo, botones laterales, micrófono abajo).

### D16 · Cierre — 0:30

**Título:** *Natural y verificable*
**Viñetas:** demo en vivo ahora · repo · contacto
**Qué decir:** «Un agente que se puede interrumpir, que tiene cuerpo y tono, y que no inventa. Ahora
lo vemos en vivo».

---

## Parte 2 · Demo (10:00)

### Antes de empezar (ya hecho, fuera del cronómetro)

- `/consola` abierta en la URL de **producción**, ya calentada (una pregunta hecha antes), en Chrome o
  Edge, pantalla compartida. `/admin` abierta en **otra pestaña**.
- Motor: **OpenAI** con **voz clonada** (si `VOICE_DEFAULT_ENGINE=openai` y Cartesia configurada).
- Audífonos conectados si hay eco; volumen al 70 %.
- **Video de respaldo** de la demo completa abierto en otra ventana.
- Teléfono Android con la URL abierta para el modo juego (opcional).

### Paso a paso

| Min | Qué haces | Qué dices / preguntas | Qué mostrar |
|---|---|---|---|
| 0:00–0:45 | Pulsa **«Usar mi voz»** (el slime despierta con un saltito) | «Pido permiso explícito para usar la voz; hasta ese momento solo hay texto.» | Slime dormido → despierto; aviso de IA |
| 0:45–2:00 | Pregunta por voz | **«¿Cuántas IPS públicas hay en Antioquia?»** | «Un momento.» (muletilla), slime mira de lado con tres puntos, luego rebota y **mueve los labios**; la cifra en el chat con su fuente |
| 2:00–3:00 | Pregunta y **interrumpe** a mitad de respuesta | **«Cuénteme del municipio de Medellín»** … (a los 2 s) **«No, espere, mejor de Melgar»** | El agente se calla en < 1 s; se corrige el lugar (posible pregunta: «¿Melgar, Tolima?») |
| 3:00–4:00 | Salirse del contexto | **«¿Qué clima hace hoy en Bogotá?»** y luego **«¿Quién ganó el partido de Nacional?»** | Rechaza con cortesía y vuelve a lo que sí puede hacer (regla 7 del prompt) |
| 4:00–4:45 | Límite honesto de la fuente | **«¿Hay camas disponibles hoy en el hospital de Melgar?»** | Explica: capacidad instalada de 2022, no disponibilidad; ofrece lo que sí puede |
| 4:45–6:00 | Emoción en vivo | **«Estoy muy preocupada, mi mamá está enferma y no sé a dónde llevarla en Tolima»** | Brillo azul/violeta, cara de preocupación, indicador «Parece que…» → **«¿Por qué?»**; tono cálido en la respuesta (necesita 2 señales seguidas o una explícita; si no cambia, di **«con más calma, por favor»**) |
| 6:00–6:30 | Preferencia explícita | **«Sea más directo»** y repite una pregunta | Respuesta más corta, estilo «directo» con motivo |
| 6:30–7:30 | Los avatares | Selector: **Slime → Gato → Avatar 3D → Orbe → Slime** | El tema cambia en círculo; al volver al slime, **se come el orbe**; toca y soba al slime (risa, «^ ^»), mantén pulsado (se derrite) |
| 7:30–9:15 | **`/admin`** (otra pestaña) | «Aquí está lo que el usuario no ve.» | **Emociones**: lecturas por turno, texto vs voz, discrepancia, leyenda «Probar» · **Herramientas**: SoQL exacta, ms, filas, fuente, corte, caché, **«Reconsultar»** · **Tiempos**: HUD por turno (muletilla, herramienta, primer audio útil) · **Recuperación** · **Transcripción** con marcas de tiempo |
| 9:15–10:00 | Cambiar de motor en `/admin` → Gemini y repetir una pregunta | «Mismo front, otro motor; con Gemini la voz es la del motor.» | La conversación sigue; HUD con el motor nuevo |

Si sobra tiempo: **modo juego** en el teléfono (inclinar → rueda, sacudir → salta, golpe → vibra).
Si falta: omite el cambio de motor (menciónalo).

### Qué hacer si algo falla

| Síntoma | Acción inmediata | Plan B |
|---|---|---|
| No conecta la voz / «Preparando la voz…» eterno | Recarga `/consola`; mira `/api/health` | Cambia de motor en `/admin` |
| El agente se corta solo o se responde a sí mismo (eco) | Ponte **audífonos** | Baja el volumen |
| Voz clonada falla | Nada: degrada sola a la voz del motor (avisa «voz cambiada a la del motor») | — |
| La fuente (datos.gov.co) no responde | El agente lo dice honestamente: **muéstralo como una virtud** (no inventa) | Pregunta por cifras precargadas (total de IPS, camas): salen de caché `fresh`/`stale` rotulada |
| Micrófono no funciona | **Modo texto**: escribe las mismas preguntas | — |
| Nada funciona (red) | **Video de respaldo** | Motor simulado: `…/consola?engine=fake` (guion sin red, sin micrófono; avisa «motor simulado») |
| Una cifra sale marcada «no verificada» | **Muéstralo**: es el verificador funcionando; espera la autocorrección | — |

Frase comodín: «Esto es un sistema en vivo con proveedores reales; prefiero que vean cómo se recupera
a que vean un video perfecto».

---

## Checklist del día

### La víspera
- [ ] Desplegado en Vercel desde la rama correcta (`main` del fork → producción; anota el ID del último despliegue bueno para *Instant Rollback*).
- [ ] Variables en Vercel: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `SESSION_SIGNING_KEY`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, `DATOS_GOV_APP_TOKEN`; **`VOICE_DEFAULT_ENGINE=openai`** si quieres voz clonada por defecto → **Redeploy** (las variables solo aplican a despliegues nuevos).
- [ ] `https://<dominio>/api/health`: `status: ok`, `default_engine: openai`, `engines.openai.configured: true`, `voice_modes` incluye `cloned`, `source.ok: true`.
- [ ] Créditos y topes de gasto en OpenAI, Google y Cartesia (y que no estén agotados).
- [ ] Ensayo completo cronometrado (20 + 10) **dos veces**, una en un equipo ajeno.
- [ ] Grabar el **video de respaldo** de la demo.
- [ ] Pasar la checklist de `07-pendientes-y-estado.md`.

### Una hora antes
- [ ] Red estable (cable o *hotspot* propio de respaldo).
- [ ] Chrome o Edge actualizado; permiso de micrófono concedido al dominio.
- [ ] **Calentar**: abrir la URL, pedir el brief, hacer una pregunta con cada motor (la primera conexión a la fuente puede tardar).
- [ ] Probar los parlantes del lugar: si el agente se oye a sí mismo, **audífonos** (y en Vercel, `REALTIME_NOISE_REDUCTION=near_field` solo si usas diadema).
- [ ] Cerrar apps que usen el micrófono o emitan sonido; notificaciones en silencio.
- [ ] Pestañas: `/consola`, `/admin`, `/api/health`, video de respaldo, diapositivas.
- [ ] Teléfono cargado con la URL de **producción** (los *previews* piden iniciar sesión en Vercel).
