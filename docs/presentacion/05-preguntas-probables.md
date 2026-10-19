# 05 · Preguntas probables y respuestas modelo

53 preguntas que puede hacer un grupo de investigación en sistemas interactivos y agentes
multimodales. Cada respuesta es **corta, honesta y basada en el repo** (con la ruta o el documento
que la respalda). Las marcadas con **⚠ difícil** son las que más conviene ensayar en voz alta.

Regla general: si no sabes, di «eso no lo he medido» y propón cómo lo medirías. Al grupo le importa
más el razonamiento que la respuesta perfecta.

---

## A. Autoría y uso de IA

**1. ⚠ difícil — ¿Qué hiciste tú y qué hizo la IA?**
«Yo definí qué construir y cómo: el alcance, las decisiones de arquitectura de la voz y del avatar, los
contratos —por ejemplo el contrato de eventos neutrales de voz—, y dirigí a los agentes de Claude Code
que escribieron gran parte del código. Revisé, probé en vivo y medí: las cifras que muestro salen de
llamadas reales. En el hackatón yo llevé el carril de front, voz y avatar; mi compañero, el backend, los
datos, el análisis y la integración. Después del hackatón, en mi fork, hice yo solo el slime, el modo
juego, los temas, el indicador de ánimo y la auditoría del análisis de emociones, también con agentes
de IA en paralelo. La IA escribe rápido; lo que no hace es decidir qué vale la pena, detectar que una
prueba en vivo contradice el diseño, ni medir». *(Respaldo: README «Uso de IA», `docs/12`, `git log`.
Sé exacto: en el git, durante el hackatón tu compañero también hizo commits de front —regla de 1 s
inicial, filtro de ruido, consentimiento—; no te atribuyas lo que no hiciste.)*

**2. ¿Cómo coordinaste varios agentes de IA sin que se pisaran?**
«Con contratos versionados. Las sesiones de IA no comparten memoria; lo que las sincroniza son los
documentos `docs/08`, `docs/09`, los modelos de datos y los tipos del cliente. Cada agente tenía su
carril y sus archivos». *(`CLAUDE.md`, `docs/12`.)*

**3. ¿No es arriesgado que la IA escriba código que no entiendes?**
«Por eso hay ≈ 600 pruebas, reglas con código rastreable y yo leo los diffs. Y por eso estoy aquí
explicando el código, no solo enseñándolo». *(Ten preparado explicar a mano el turno de punta a punta, `01` §5.)*

**4. ¿Qué usaste exactamente? ¿Qué es un MCP en tu flujo?**
«Claude Code con las skills `frontend-design` y `superpowers`, el MCP de Playwright para que el agente
manejara un navegador real en la QA visual, y Context7 para documentación. GPT generó el paquete de
planeación inicial». *(`docs/06`, README.)*

## B. Arquitectura

**5. ⚠ difícil — ¿Por qué esta arquitectura y no otra?** (JS4)
«Tres razones: latencia, seguridad y capacidad de cambio. El audio va directo del navegador al
proveedor, sin un salto por mi servidor. El backend es HTTP sin estado, así que escala solo y no
guarda nada personal. Y con puertos y adaptadores cambio de motor de voz o de fuente de datos sin tocar
el resto». *(`01` §4.)*

**6. Si el backend no tiene estado, ¿dónde está la memoria de la conversación?**
«En el navegador: un estado canónico pequeño —filtros confirmados, sedes seleccionadas, últimos
turnos, versión de estado— que viaja con cada llamada a una herramienta y vuelve con un parche».
*(`docs/10` §4.)*

**7. ¿Qué pasa si se cae un motor a mitad de conversación?**
«Se renueva una vez; si vuelve a fallar, el controlador cambia al otro motor y lo siembra con un sobre
de contexto neutral: estado, últimos cuatro turnos oídos y hasta cinco resultados de herramientas. No
repite audio ni vuelve a consultar». *(`docs/08` §7.)*

**8. ¿Por qué FastAPI y no Node para el backend?**
«El analista es LangGraph, que es Python, y el equipo ya tenía una base en FastAPI. Como el backend solo
hace HTTP corto, el lenguaje no limita la latencia de la voz».

**9. ¿Por qué no una base de datos?**
«El contexto es la API en vivo y el estado cabe en el navegador. Sin base de datos: menos superficie de
privacidad, nada que sincronizar, escala horizontal trivial. Si hiciera falta guardar conversaciones
—la demo de administración que propone mi compañero— sí habría que añadirla». *(D-23.)*

**10. ¿El motor de voz no rompe tu regla de que el LLM no controla el flujo?**
«Sí, y está declarado como excepción acotada, D-14: el motor decide los turnos y qué herramienta
llamar, porque es lo que da la latencia. Todo lo demás es determinista: el servidor valida cada
llamada contra una lista cerrada, decide grano, unidad y advertencias, y verifica las cifras».

**11. ¿Cuánto cuesta cambiar de fuente de datos?** (JS3)
«Reescribir las herramientas de `services/ips/`, el léxico y el prompt de `config/`. Motores, verificador,
analista, front y despliegue no cambian».

**12. ¿Seguridad? ¿Qué impide que alguien use tus claves?**
«La clave nunca llega al navegador: emito credenciales efímeras de un solo uso o de minutos, con alcance
mínimo; la sesión es un token firmado con HMAC; hay límites de tasa por sesión y por IP. En OpenAI la
credencial no bloquea la configuración, por eso cada herramienta se valida igual en el servidor».
*(R-28, `openai_session.py`.)*

## C. Voz y toma de turnos

**13. ¿Por qué speech-to-speech y no una cascada STT→LLM→TTS?**
«Por tiempo y latencia: en seis horas era lo único realista con buenas interrupciones. La cascada es
más barata y controlable; la tengo como "motor 3" en el backlog y es la principal vía para bajar
costos». *(D-11, B-04, `03`.)*

**14. ¿Cómo distingues una interrupción de un ruido?**
«Con la regla de un segundo: mientras el agente habla y detecto voz, le bajo el volumen al 30 %; si la
voz dura un segundo, corto; si no, era ruido y sigue. En Gemini lo hago con mi propio detector de voz en
el navegador porque el servidor no oye mientras habla». *(`docs/08` §6.)*

**15. ⚠ difícil — Un segundo es mucho. ¿No hace que el agente parezca sordo?**
«Es un compromiso: con ruido ambiente, cortar al primer sonido era peor. Mientras se confirma, el
agente baja el volumen, lo que ya se percibe como que te está escuchando. Lo correcto sería un fin de
turno semántico o un clasificador de "interrupción vs *backchannel*" —un "ajá" no debería cortar—;
está en el backlog (B-14). No lo he medido con usuarios».

**16. ¿Qué latencia tiene?**
«Primer audio útil con consulta, mediana 3,9 s con OpenAI y 4,2 s con Gemini; antes eran 9 y 13. El
percentil 95 es 4,7 y 6,9 s: mi meta de 4 s no se cumple. Muestra de diez turnos, servidor local».
*(`docs/00` §6.)*

**17. ¿Cómo bajaste de 9 a 3,9 s?**
«Medí dónde se iba el tiempo: el aviso de IA se decía antes de la consulta y sumaba 11 a 24 s. Lo moví
al final, pedí una muletilla de dos palabras, que empiece por la cifra en una frase, precargué los diez
agregados más probables y dejé la conexión a la fuente caliente». *(`docs/anexos/bench-latencia-2026-10-09.md`.)*

**18. ¿Qué pasa con el eco?**
«Cancelación de eco "all", que incluye lo que suena por Web Audio, más aislamiento de voz y reducción
de ruido del proveedor. Con parlantes reales no lo he verificado; si el agente se oye a sí mismo, uso
audífonos». *(`docs/08` §6, «Sin verificar».)*

**19. ¿Cómo sabes qué parte de la respuesta escuchó realmente la persona?**
«Llevo los milisegundos reproducidos por generación; con la voz clonada, Cartesia da marcas de tiempo
por palabra y tomo las palabras que terminaron antes del corte. El historial solo guarda lo oído».

**20. ⚠ difícil — Tu compañero dice que en conversaciones largas la voz se degrada. ¿Qué haces?**
«Es cierto, lo observó: en conversaciones medianamente largas el motor cambia de entonación. La causa
probable es que el contexto de audio acumulado del modelo realtime crece. La solución reutiliza una pieza
que ya tenía, la renovación de sesión entre turnos con un sobre de contexto compacto en texto: ahora se
dispara también cada seis turnos o al pasar de unos 20.000 tokens de contexto, esperando un silencio
para no cortar a nadie; y en el prompt fijé explícitamente idioma, voz y entonación. Además abarata las
llamadas largas, porque el contexto deja de crecer. Lo probé con Gemini real en 13 preguntas: dos
renovaciones de 0,7 s, sin que se note, y el agente recordó la primera cifra gracias a un resumen de los
turnos antiguos». *(Hecho el 18-oct; falta probarlo por voz y con OpenAI. Ver `02` y `07`.)*

**21. ¿Por qué tu voz clonada solo funciona con OpenAI?**
«Porque necesito que el motor responda solo en texto, y los modelos de Gemini Live disponibles lo
rechazan. Silenciar el audio de Gemini y sintetizar su transcripción pagaría dos veces y llegaría tarde».
*(D-22.)*

**22. ¿Cómo manejas los errores del reconocimiento de voz?**
«Tres cosas: filtro las transcripciones fantasma sobre ruido; el léxico normaliza nombres y, si hay
homónimos, el agente pregunta en lugar de elegir; y el prompt corrige confusiones típicas, como EPS por
IPS. Más estrategias, como sesgar el reconocedor con vocabulario del dominio, en mi documento de
investigación». *(`transcript-filter.ts`, `lexicon.py`, `03`.)*

## D. Multimodalidad (JS5: preguntarán mucho)

**23. ⚠ difícil — ¿Qué es multimodal aquí, más allá de "habla y escucha"?**
«Entradas: voz analizada en contenido y en prosodia, texto, señales de interacción —velocidad, pausas,
si interrumpió, si repite—, tacto sobre el avatar e inclinación y movimiento del teléfono. Salidas: voz,
cuerpo con estados y caras, labios sincronizados, luz de color, texto con evidencia y vibración. El
afecto fusiona texto y voz».

**24. ¿Qué tipo de fusión usas?**
«Fusión tardía y determinista: cada canal produce sus etiquetas y una regla las combina: incierto
cuenta como ausente; si coinciden, esa; si discrepan, manda la voz salvo que solo las palabras traigan
emoción, y se marca la discrepancia». *(`nodes/fuse.py`.)*

**25. ¿Por qué no fusión temprana o un modelo multimodal de extremo a extremo?**
«La rama de voz ya usa un modelo multimodal (Gemini con audio). Mantener la fusión explícita me da
explicabilidad: puedo decir por qué y mostrar la discrepancia. Una fusión aprendida necesitaría datos
etiquetados que no tengo».

**26. ⚠ difícil — Si te pido un análisis multimodal adicional, ¿qué añadirías?**
Estrategias preparadas (elige 2–3 según la pregunta):
- **Expresión facial por cámara** (con consentimiento; ojo: AI Act art. 5.1.f en trabajo/educación).
- **Modelo dedicado de emoción en la voz** (SER) en lugar de un LLM general, comparado con el actual (B-12).
- **Rasgos prosódicos estándar** (p. ej. el conjunto eGeMAPS de openSMILE) en vez de mis cuatro medidas.
- **Fin de turno semántico y *backchannels*** (B-14): no cortar por un «ajá».
- **Diarización de varias personas** (B-07): un acompañante junto al adulto mayor.
- **Mirada y atención** con la cámara para saber si la persona está mirando la pantalla.
- **Señales de compromiso** (abandono, repeticiones, tiempo hasta responder) ya parcialmente medidas.
- **Salida**: gestos del avatar sincronizados con la prosodia de la voz, no solo labios.
«Y antes de añadir modalidades, validaría las actuales con usuarios».

**27. ¿El avatar cambia según la emoción de la persona? ¿Bajo qué teoría?**
«Sí: nueve caras y el brillo. La idea es la "sintonía afectiva" o *mirroring* moderado de la
computación afectiva y los agentes conversacionales con cuerpo: mostrar que el agente percibió el
estado. Pero no está evaluado si mejora la experiencia: es una hipótesis».

**28. ¿Los labios son visemas reales?**
«Son cinco vocales deducidas del espectro del audio en tres bandas de formantes, no visemas
fonéticos del texto. Funciona con cualquier voz e idioma. Alternativas: visemas del TTS (Azure los da en
español, OpenAI y Gemini no) o texto a fonemas (TalkingHead no tiene español)». *(`lipsync.ts`, `docs/anexos/us2`.)*

**29. ¿Y el modo juego qué aporta a la investigación?**
«Hipótesis: el juego baja la ansiedad ante la tecnología y crea vínculo con el agente, y usa el
teléfono como dispositivo multimodal: sensores de entrada, vibración de salida. No tengo evidencia aún;
por eso lo presento como exploración».

## E. Emociones y ética

**30. ⚠ difícil — ¿Cómo evaluaste el reconocimiento de emociones?**
«Con 39 frases etiquetadas a mano más 10 de control con expresiones que el prompt no menciona;
mido acierto en las tres etiquetas a la vez. Gemini pasó de 32 a 36 y OpenAI de 28 a 37 tras el
prompt affect-v2. Limitaciones: un solo criterio de etiquetado, sin acuerdo entre anotadores medido;
el prompt se ajustó mirando esas mismas frases (por eso existen las 10 de control); la rama de voz solo con
voces sintéticas. Lo siguiente: un conjunto con voces humanas y varios anotadores, con kappa».
*(`docs/10` §6.)*

**31. ¿Por qué esas etiquetas de emoción?**
«Las básicas de Ekman más neutral e incierta, y aparte estados de la tarea —frustración, confusión,
prisa, satisfacción— porque son los que realmente deciden cómo debe responder un asistente».

**32. ¿Cómo afecta la emoción al comportamiento del agente?**
«Solo a través de una política de estilo determinista en YAML: directo, cálido, didáctico o neutro.
Cambia tono y longitud, nunca hechos. Hacen falta dos señales seguidas para cambiar; una preferencia
explícita gana siempre». *(`config/style_policy.yaml`.)*

**33. ¿Por qué miedo y tristeza van antes que frustración?**
«Porque los modelos etiquetaban como "frustración" a personas asustadas o en duelo, y eso les daba
respuestas secas. Una persona preocupada necesita paciencia, no brevedad».

**34. ⚠ difícil — Inferir emociones, ¿no es problemático éticamente? ¿Y en Europa?**
«Sí. En la UE, el AI Act prohíbe inferir emociones a partir de datos biométricos en el trabajo y la
educación, y exige transparencia en otros contextos; en Colombia, la voz puede ser dato sensible según
la Ley 1581. Por eso: consentimiento explícito con un botón, indicador visible, se puede apagar, el
audio no se guarda, no se muestra una confianza falsa, no se diagnostica, y la persona puede decir "no
es así". Para un uso real haría falta una evaluación jurídica». *(R-26, `docs/10` §6.)*

**35. ¿Guardas datos? ¿Telemetría?**
«No hay base de datos. El audio vive en memoria durante la petición y se descarta; en las trazas solo
aparece su tamaño. La sesión es anónima. Si se añade la demo de administración con conversaciones
guardadas, habría que definir qué se guarda, para qué, con consentimiento y retención limitada».

**36. ¿La voz clonada no es un deepfake?**
«Es una voz de un integrante del equipo, con su consentimiento, revocable; el agente se presenta como
IA y nunca como esa persona, y se avisa de que es voz sintética. A Cartesia solo va el texto del agente,
nunca el micrófono del usuario». *(`docs/08` §15.7.)*

## F. Respuestas verificables y alucinaciones

**37. ¿Cómo evitas que invente?**
«Tres barreras: prompt de mundo cerrado, un texto exacto con las cifras como resultado de la
herramienta, y un verificador sin LLM que revisa cada cifra dicha; si falla, el agente se corrige en voz
alta». *(`01` §3.4.)*

**38. ⚠ difícil — "0 alucinaciones en 20 casos" es una muestra pequeña. ¿Qué vale?**
«Es una prueba de humo, no una garantía estadística: 20 casos trampa con el motor real, uno por
categoría —cifras, fuera de alcance, ambigüedad, inyección, conocimiento general, corrección,
seguimiento—. Además se hizo con OpenAI y una versión anterior del prompt, la v2; no la he repetido con
la v9 ni con Gemini. Lo honesto es ampliar el conjunto y repetirlo por versión». *(`docs/anexos/eval-grounding-2026-10-09.md`.)*

**39. ¿Qué no detecta tu verificador?**
«Números dichos en palabras, números menores de 10, y cualquier error que no sea una cifra: un nombre
equivocado o decir que una IPS no existe. Para eso propongo el supervisor LLM».

**40. ¿Cómo sería el agente supervisor del proyecto macro?** (JS6)
«En capas: lo verificable con reglas, con reglas —mi verificador—; un supervisor LLM pequeño en
paralelo, fuera de la ruta crítica, que juzgue si cada afirmación se sigue de la evidencia, y que use la
misma nota de autocorrección; y una evaluación offline por versión. Así el supervisor no añade latencia
ni sus propias alucinaciones donde una regla basta».

**41. ¿Por qué no dejas que el modelo calcule porcentajes?**
«Porque los LLM calculan mal. Porcentajes, diferencias y razones se calculan en Python y el modelo
solo los lee; el prompt le prohíbe hacer cuentas propias».

## G. Costos

**42. ⚠ difícil — ¿Cuánto cuesta una conversación? ¿Es rentable?**
«Depende del motor y la duración. Los modelos realtime vuelven a cobrar el contexto acumulado en cada
turno, así que el costo crece más que linealmente. Con mis supuestos, una llamada de 5 minutos con
Gemini Live sale en torno a 0,23 USD y una de 15 minutos en torno a 1,56; OpenAI con caché, 0,29 y 0,99.
Por minuto de lista Gemini es unas cuatro veces más barato, pero sin caché se vuelve más caro hacia los
siete u ocho minutos. Una cascada propia sería de 4 a 7 veces más barata en 15 minutos. Son
estimaciones, no facturas». *(Fuente: `03` §1.3–§1.4, marcadas [I]. Matiz con tu compañero: su «la
mitad» es parcial, y su «10×» vale como orden de magnitud solo si se compara con el LLM de texto; con
la cascada completa es 4–7×. **No des números que no estén en el 03.**)*

**43. ¿Cómo bajarías los costos?**
«Lo de mayor impacto: renovar la sesión cada pocos turnos sembrando un resumen en texto —en 15 minutos
de Gemini, de 1,56 a unos 0,45 USD estimados—. Luego, ajustar la compresión de contexto del proveedor,
respuestas cortas, un modelo realtime más pequeño si la calidad aguanta, cortar sesiones inactivas, y
una cascada propia para conversaciones largas. Curiosamente, en OpenAI la voz clonada abarata, porque
no se paga el audio de salida del motor». *(`03` §1.5, E1–E9.)*

**43b. ⚠ difícil — ¿Por qué no reconoces quién habla (reconocimiento de hablante)?**
«A propósito, por cuatro razones: Azure retiró su servicio de reconocimiento de hablante en 2025 y no
hay un reemplazo gestionado sencillo; con turnos de uno o dos segundos el error crece mucho; una huella
de voz es un dato biométrico sensible en Colombia y en la UE; y la app es anónima, no hay a quién
verificar. Si hiciera falta, sería un filtro suave en el dispositivo —¿es la misma persona que empezó?—,
con consentimiento aparte, nunca un bloqueo». *(`03` §3.)*

**44. ¿Cuánto costó el hackatón?**
«Céntimos por demo según `docs/11` §10; no tengo una cifra total medida».

## H. Evaluación e investigación

**45. ⚠ difícil — ¿Cuál es tu pregunta de investigación y cómo la evaluarías?**
«¿Puede un agente social de voz ser natural —latencia, interrupción, tono, cuerpo— y a la vez
verificable? Evaluación: métricas objetivas (latencia p50/p95, tasa de alucinación, tasa de
interrupciones correctas vs falsas) y un estudio con usuarios —idealmente adultos mayores— comparando
condiciones: con y sin avatar, con y sin estilo adaptativo, slime frente a humano; con medidas de
confianza, carga cognitiva, éxito de la tarea y satisfacción». *(Backlog B-10.)*

**46. ¿Hiciste pruebas con usuarios?**
«No con un protocolo formal. Hubo pruebas en vivo del equipo y la revisión de mi compañero desde la
perspectiva de adultos mayores. Es lo primero que haría».

**47. ¿Qué es lo más novedoso?**
«La combinación: conversación de voz en tiempo real interrumpible, verificación determinista de cifras
con autocorrección hablada, y un cuerpo procedural que expresa el estado y la emoción, con
transparencia sobre la inferencia afectiva. Cada pieza existe; juntarlas con contratos y medirlas es el aporte».

**48. ¿Qué estado del arte conoces?**
«Agentes conversacionales con cuerpo, computación afectiva, modelos speech-to-speech, guías de diseño de
IA humano-céntrica (Microsoft HAX, Google PAIR), y en Europa propuestas como Kyutai (fin de turno
semántico) o Mistral Voxtral. Lo detallo en mi documento de investigación». *(`03`, `docs/13` §2.)*

## I. Diseño y accesibilidad

**49. ¿Por qué un slime para adultos mayores?**
«Una cara grande y legible, silueta calmada, lenguaje corporal que dice el estado aunque no haya
sonido, y sin el valle inquietante de un humano realista. Es una hipótesis de diseño, no validada».

**50. Tu compañero dice que la interfaz tiene demasiadas cosas. ¿Por qué no lo cambiaste?**
«Mi asesor me pidió que esta entrega muestre capacidades técnicas; lo específico para adultos mayores
—etiquetas en todos los iconos, uno o dos botones, el agente como protagonista, el ánimo solo para
administradores— es la siguiente fase. Sí apliqué ya lo general: tipografía, sombras y botones
consistentes, contraste, responsividad». *(`feedback-recibido.md` §2.)*

**51. ¿Es accesible?**
«Contraste AA medido en 150 pares de color, el color nunca va solo, subtítulos y transcripción, uso
por teclado, movimiento reducido respetado, modo texto. Falta lo de adultos mayores: tamaño de textos y
etiquetas, y probarlo en dispositivos reales».

**52. ¿Funciona en el móvil?**
«Sí en Chrome de Android emulado, y el modo juego está pensado para el teléfono; el compañero detectó
problemas de responsividad que se están corrigiendo. No lo he probado en muchos dispositivos reales».
*(`07`.)*
