# Feedback recibido (2026-10-17) y decisiones para la presentación

Transcripción fiel de dos documentos y un chat, más lo que el dueño decidió aplicar. Sirve como
entrada para el pulido visual, la estabilidad de voz y el paquete de estudio.

## 1. Contexto de la presentación

- Pasantía en un **grupo de investigación en sistemas interactivos y agentes multimodales** (el público
  incluye investigadores de España: no conocen el término «IPS»).
- Duración: **20 minutos de presentación + 10 minutos de prueba (demo)** = 30 minutos máximo.
- El dueño ya tiene una plantilla de diapositivas; el derrotero (guía de 18 diapositivas) está más abajo
  con los comentarios del asesor.

## 2. Mensaje del asesor (Johnny Alexander Salazar, chat del 17-10-2026)

> Ya leí el feedback que te hizo tu compañero... muy acertado a nivel visual (pero todo eso se podría
> aplicar es para cuando realmente se vaya a enfocar en adultos mayores).
> Lo de unificar el tipo de letra, algunos elementos con sombra y otros no, etc. (sí me parece adecuado
> para esta entrega). Pero lo de falta de labels, etc. aún no.
> La idea de esta presentación es mostrar de lo que eres capaz de hacer y de los conocimientos técnicos
> sobre el tema. Ya luego se puede aplicar todo realmente a adultos mayores.
> Finalmente, lo que comenta tu compañero para la reducción de costos me parece muy pertinente.

**Decisión del dueño:** aplicar ahora las recomendaciones visuales generales (tipografía unificada,
jerarquía de pesos y tamaños, sombras consistentes, estilos de botones y hover estandarizados, contraste,
responsividad, tooltips consistentes, botones que fallan). **No aplicar todavía** lo específico para adultos
mayores (labels en todos los iconos, simplificar a 1–2 botones, quitar el modo juego, quitar el ánimo de la
vista de usuario, rediseño con el agente como protagonista sin chat): eso se presenta como **trabajo futuro**.
La reducción de costos, la supresión de ruido y el reconocimiento de voz van **en la presentación** como
análisis y estrategia.

## 3. Feedback del compañero (documento «feedback.pdf», enfocado en adultos mayores)

### Interfaz
- **Legibilidad:** la fuente no está estandarizada; no hay jerarquía de pesos ni tamaños; hay lenguaje
  técnico por todas partes (p. ej. «Registro de IPS de Colombia · REPS, corte 5-nov-2022» en el header, la
  línea «REPS · MinSalud, corte nov-2022», «Asistente de IA: puede equivocarse…», el pie «Datos: REPS ·
  MinSalud… Licencia CC BY-SA 4.0»); iconos confusos sin label (pantalla completa, cámara, zoom); el estado
  «Hablando» es ambiguo (¿habla el agente o la persona?); hay estados irrelevantes; el ánimo puede confundir
  al usuario final, podría ser solo para administradores; labels MUY pequeños (los adultos mayores no leen
  ciertos px); que la tipografía no se arruine en diferentes tamaños de pantalla; los labels de los modos
  (Slime, Avatar 3D, Orbe) podrían expresarse de otra forma.
- **Navegación:** «súper buena implementación de driver.js» (el recorrido de ayuda; en realidad es propio,
  no driver.js), la dejaría 100 % pero con un **iconito en cada tarjeta** para que sea más amena;
  demasiadas opciones abruman: **21 cosas** se pueden hacer al entrar a `/consola` (en celular imposible de
  usar); lo primero que se mira es el slime y distrae del panel derecho, que es sobrio y aburrido; propone
  unificar ambos: el agente como protagonista y la experiencia girando en torno a él (boceto: slime en el
  centro con un globo de diálogo, botones laterales para jugar y ver transcripción, micrófono abajo).
- **Botones:** falta estandarización de estilos; **el negro no contrasta con morado** (botón «Detener»
  oscuro junto a lila); a uno le pusiste sombra y a los demás no; unos tienen animación al hover y otros no;
  **hay dos botones de micrófono** (el morado «Usar mi voz» no pide permisos al navegador); **el botón
  «Silenciar» no sirve**.
- **Estado del agente:** «súper bien los estados, pero me aseguraría de usar todos (y parametrizar bien
  cuándo se deben usar, te puede dar un plus metodológico)» — se refiere a la leyenda de emociones y caras.
- **Control:** funciona al hablar y dejar de hablar, pero hay mucha funcionalidad; dejaría 1 o 2 botones
  (hablar, parar, silenciar y salir); el botón «Jugar» solo si hay una tesis que lo respalde.
- **Accesibilidad:** algunos botones tienen tooltip, otros no; «0 responsividad, fixear eso»; en celular
  «no se entiende nada» (capturas de `/consola` y `/admin` en móvil).

### Comunicación
- Quitaría el ejemplo de las IPS por técnico; buscar un tema central más entendible y quizá otra API pública.
- Cómo usas Gemini Live está súper bien; **extraer el prompt de comunicación** para mostrarlo.
- **IMPORTANTE:** en conversaciones medianamente largas **el agente se ofusca**, lo que provoca que **cambie
  de voz o entonación agresivamente**. Recomienda (si Gemini lo permite) **restablecer el búfer del agente
  cada X turnos** para que no se dañe la voz y no asuste a los usuarios.

### Aspectos técnicos
- Gemini Live está muy bien: **la mitad de caro que OpenAI Realtime**, pero **unas 10 veces más caro que un
  pipeline propio pagando solo el LLM**, porque los modelos realtime acumulan los tokens de contexto en cada
  inferencia («en 5 minutos de llamada te terminan cobrando 15»); en llamadas largas se encarece mucho.
  Tenerlo presente si preguntan por rentabilidad: es bueno tener varias opciones.
- Telemetría, privacidad y pasos futuros: qué datos guardar, para qué, qué datos sensibles se recolectarían,
  qué se espera conseguir, cómo se evalúan las emociones, cómo afectan las emociones al comportamiento del
  agente y bajo qué tesis, cómo se evaluarían esos resultados, qué medidores de éxito, objetivos, preguntas
  de investigación, estado del arte.
- Administración: tener **2 demos**, una para usuarios (adultos mayores) y otra de administración, con las
  conversaciones guardadas y métricas y quizá acciones recomendadas.
- Cierre: «es un grupo de investigación, importa más el proyecto y sus aportes que el propio software:
  bases teóricas para cada cosa que hagas».

## 4. Comentarios del asesor sobre el derrotero (documento «Derrotero Presentación.pdf»)

- **JS1 (diapositivas 2, 3 y 4):** centralizar «El problema», «La pregunta de investigación» y el origen en
  uno solo. Decir simplemente que tuviste la oportunidad de hacer un **desarrollo de agente social
  interactivo** y que el que vas a mostrar está orientado a **consultar sobre puntos de atención médica en
  Colombia** e información de estos. Como el público es español, **no decir «IPS»** sin explicarlo.
- **JS2 (demo):** en la interacción enfocar principalmente la **interacción con el avatar**, los diferentes
  avatares implementados, los **tiempos cortos de respuesta**, la **posibilidad de interrupciones**, mostrar
  que si se le pregunta por otro contexto (el clima, un partido de fútbol) **no se sale de su contexto**,
  **sincronización de labios**, **clonación de voz**, las **métricas**, el **análisis de sentimientos en
  tiempo real**.
- **JS3 (fuente datos.gov.co):** decir que es para este caso, pero que **puede ser cualquier otra fuente de
  datos**.
- **JS4 (backend):** enfocarse en la **arquitectura del backend**: por qué esa arquitectura y qué beneficios
  ofrece.
- **JS5 (multimodalidad):** probablemente harán **muchas preguntas**; profundizar y tener **estrategias
  adicionales** por si piden análisis multimodal adicional.
- **JS6 (respuestas verificables):** «me parece súper»; en el proyecto macro piensan implementar **2
  agentes**: uno que interactúa con el usuario y otro **supervisor** que analiza que el primero no esté
  alucinando. Hablar de esto o proponer una idea diferente.
- **JS7 (MCP):** **aclarar la diferencia entre MCP y herramienta** antes de hablar de los MCP usados.

## 5. Derrotero original (18 diapositivas)

1 Portada · 2 El problema · 3 La pregunta de investigación · 4 Demo · 5 Arquitectura general · 6 Cómo está
construido el código · 7 El backend por dentro · 8 Multimodalidad · 9 Toma de turnos y pausas · 10 Voz
clonada y naturalidad · 11 Respuestas verificables · 12 Emoción y estilo adaptativo · 13 Un avatar para
adultos mayores · 14 Cómo trabajamos (SDD e IA) · 15 MCP y herramientas · 16 Resultados medidos ·
17 Limitaciones y ética · 18 Trabajo futuro y cierre.
