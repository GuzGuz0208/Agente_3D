# Despliegue (Vercel) y operación de la demo

Contrato vigente · versión `2026-10-09.1` · dueños: **A** (web) y **B** (API) — [12](12-guia-de-trabajo-2-personas.md).
Decisiones: D-15 (Vercel + Dockerfile de respaldo), D-19 (`main` = producción). Reglas: R-05, R-28, R-30.
Requisitos del reto: RETO-R08, E01–E03, M06, M07 ([07](07-reto-01-especificacion.md) §9).

## 1. Topología

**Vigente desde el 2026-10-09 ≈ 14:25 (propuesta, pendiente de confirmar): un solo proyecto con
[Vercel Services](https://vercel.com/docs/services)** (`vercel.json` en la raíz). Servicio `web`
(Astro estático, raíz `web/`) público en `/`; servicio `api` (FastAPI, raíz `.`, entrypoint
`src.api.app_voice:app`) público en `/api/*`. Vercel entrega a la API la ruta **con** el prefijo
(`/api/health`); `StripPathPrefix` en `app_voice.py` lo quita (`API_PATH_PREFIX`, por omisión `/api`),
así que en local siguen valiendo `/health` y compañía. La web se compila con `PUBLIC_API_URL=/api`
(relativa, mismo dominio: sin CORS). **Sin bindings:** la web es estática y no llama a la API desde un
servidor, solo desde el navegador. Variables de entorno: una sola vez en el proyecto. Prueba local de
ambos servicios juntos: `vercel dev`. Lo de abajo (dos proyectos) queda como alternativa.

```
Navegador ──HTTPS──► Vercel · proyecto web  (Astro estático)            https://<dominio>/
Navegador ──HTTPS──► Vercel · proyecto api  (FastAPI, solo HTTP)         https://<api>/   (CORS: solo el origen del web)
Navegador ──WSS───► OpenAI Realtime / Gemini Live                        (credencial efímera emitida por la api)
Navegador ──WSS───► Cartesia (solo con la voz clonada, opcional)         (token de acceso emitido por la api)
api ──HTTPS──► datos.gov.co (SODA3)   ·   api ──HTTPS──► Gemini / OpenAI / Cartesia (analista, credenciales)
```

Dos proyectos de Vercel (carril A despliega `web`, carril B despliega `api`). Alternativa si
se verifica en G1: **un solo proyecto con servicios** (Astro + Python bajo un mismo dominio,
sin CORS). **No hay WebSocket propio, base de datos ni modelo de embeddings**: el audio va navegador ↔ proveedor.

| Proyecto | Raíz | Rama de producción | Previews |
|---|---|---|---|
| `web` | `web/` | `main` | cada rama de carril |
| `api` | `.` con entrypoint `src/api/app_voice.py` (`tool.vercel.entrypoint`) | `main` | cada rama de carril |

## 2. Variables de entorno (se definen en Vercel; nunca en git, R-05)

| Variable | Proyecto | Para qué |
|---|---|---|
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | api | Credenciales efímeras de los motores y analista |
| `CARTESIA_API_KEY` | api | Emite el token de acceso de la voz clonada (`POST /speech/session`, [08](08-contrato-voz-en-vivo.md) §15.3). **Opcional:** sin ella, `GET /health` no anuncia `cloned` y solo se ofrece la voz del motor. Nunca llega al navegador (R-28) |
| `CARTESIA_VOICE_ID` | api | Identificador de la voz clonada del equipo; el backend lo entrega al navegador junto al token. No es un secreto, pero se configura aquí para no fijarlo en el código. Requerida si hay `CARTESIA_API_KEY` |
| `DATOS_GOV_APP_TOKEN` | api | Token SODA3 (opcional; si es inválido se descarta, [09](09-datos-en-vivo-datos-gov-co.md) §2) |
| `SESSION_SIGNING_KEY` | api | Firma de la sesión anónima (32 bytes aleatorios) |
| `ALLOWED_ORIGINS` | api | Origen(es) del web para CORS. **Con Vercel Services no hace falta** (web y api comparten dominio); solo con dos proyectos o el contenedor |
| `LANGSMITH_API_KEY`, `LANGSMITH_TRACING` | api | Trazas y feedback (opcional) |
| `VOICE_DEFAULT_ENGINE` | api | Motor que la interfaz elige al cargar (`GET /health` → `default_engine`). Por omisión **`gemini`**, para que las pruebas no gasten la cuota de OpenAI. **El día de la demo final: `openai`** (vuelve también la voz clonada por defecto, si `CARTESIA_API_KEY` está). El selector de /admin sigue ofreciendo los dos motores |
| `REALTIME_NOISE_REDUCTION` | api | Reducción de ruido de entrada de OpenAI. Por omisión `far_field` (micrófono del PC o portátil); `near_field` con diadema o audífonos; vacío la apaga |
| `GEMINI_ACTIVITY_HANDLING` | api | Por omisión `NO_INTERRUPTION`: Gemini no corta al agente por cualquier sonido y el navegador aplica la regla de 1 s ([08](08-contrato-voz-en-vivo.md) §6). `START_OF_ACTIVITY_INTERRUPTS` devuelve la interrupción al servidor (cualquier voz corta al instante) |
| `VOICE_REFRESH_TURNS` | api | Renovación de contexto ([08](08-contrato-voz-en-vivo.md) §7.1): cada cuántos turnos el navegador renueva la sesión del motor entre turnos, sembrada con el sobre neutral, para que la voz no derive en conversaciones largas. Por omisión **`6`**; `0` la apaga |
| `VOICE_REFRESH_TOKENS` | api | Igual, cuando el proveedor informa más tokens de contexto que este número (Gemini `usageMetadata`, OpenAI `response.usage`). Por omisión `20000`; `0` lo apaga |
| `GEMINI_COMPRESSION_TRIGGER_TOKENS`, `GEMINI_COMPRESSION_TARGET_TOKENS` | api | Red de seguridad en el servidor de Gemini: `contextWindowCompression.slidingWindow` con umbrales explícitos (por omisión `32000` / `16000`; el del proveedor es el 80 % de 128k). `0` en el disparador vuelve al valor del proveedor |
| `PUBLIC_API_URL` | web | URL base de la api (se fija en la compilación) |

**Volver a OpenAI el día de la demo:** `npx vercel env add VOICE_DEFAULT_ENGINE` con el valor
`openai` en el proyecto api (local: `VOICE_DEFAULT_ENGINE=openai` en `.env`) y redesplegar la api.
No hace falta recompilar el web: lo lee de `/health` al cargar la página.

Lectura de variables **solo** en `src/config.py` (R-05); `LANGSMITH_*` las lee la librería
(excepción documentada). Los worktrees locales usan su propio `.env` (ignorado por git).

## 3. Backend en Vercel

- **Dependencias mínimas** (sin `torch`, `sentence-transformers` ni `psycopg`): `fastapi`, `httpx`, `pydantic-settings`, `pyyaml`, `langgraph`, `langchain-core` y `uvicorn` (solo contenedor/local). El app de voz llama a Gemini, OpenAI y Cartesia con `httpx`: **no** usa `langchain-google-genai` ni `langchain-openai`. Medido el 2026-10-09: `site-packages` de ~63 MB (límite 500 MB) e importación de `api.app_voice` en ~1 s.
- **Dónde está cada cosa:** `requirements.txt` = runtime mínimo de Reto 01; `requirements-dev.txt` = `-r requirements.txt` + pruebas + scripts de medición (desarrollo: `pip install -r requirements-dev.txt`). `pyproject.toml` repite el runtime mínimo como lista **estática** en `[project].dependencies` porque Vercel, si hay `pyproject.toml` y `requirements.txt`, instala desde `pyproject.toml` (con `uv`). **Las dos listas se mantienen iguales.**
- **Entrypoint:** `[tool.vercel] entrypoint = "src.api.app_voice:app"` en `pyproject.toml` (mecanismo documentado por Vercel). `vercel.json` fija `regions: ["iad1"]`, `maxDuration` 60 s y `excludeFiles` (`tests/`, `docs/`, `web/`, `scripts/`, `spikes/`, `.venv*`, `.env*`); `.vercelignore` evita subir `.env` y lo mismo con `vercel deploy`. El bundle incluye `src/`, `config/` y `data/lexicon.json` (las rutas salen de `src/config.py`, relativas a la raíz). Cabecera global `Permissions-Policy` en `vercel.json`: micrófono, acelerómetro, giroscopio, magnetómetro y pantalla completa permitidos para el propio origen (modo juego en el celular); `vibrate` no es una directiva que Chrome reconozca y no hace falta.
- **Despliegue del proyecto `api` (carril B, desde la raíz del worktree):**
  ```bash
  npx vercel login
  npx vercel link                      # proyecto "api", raíz "." (no web/)
  npx vercel env add GEMINI_API_KEY    # y lo mismo para: OPENAI_API_KEY, DATOS_GOV_APP_TOKEN,
                                       # SESSION_SIGNING_KEY, ALLOWED_ORIGINS, CARTESIA_API_KEY, CARTESIA_VOICE_ID
  npx vercel deploy                    # preview; producción sale de main (D-19)
  ```
- **Límites a recordar:** cuerpo de petición y respuesta **4,5 MB** (los recortes WAV de ≤ 30 s caben, [08](08-contrato-voz-en-vivo.md) §4); duración máxima 300 s en Hobby (las llamadas del reto duran segundos); memoria 2 GB / 1 vCPU.
- **Región:** la predeterminada es `iad1`; medir una alternativa más cercana a Colombia en G1.
- **Calentamiento:** el brief ([09](09-datos-en-vivo-datos-gov-co.md) §8) abre la conexión a la fuente; el primer arranque en frío se mide en G1.
- **Dependencias — resuelto en G1 con la salida (1):** `requirements.txt` es el conjunto mínimo de Reto 01; lo pesado de la base genérica (modelo de embeddings, controlador de base de datos, `langchain-google-genai`) se retiró con D-23 y las pruebas viven en `requirements-dev.txt`; `pyproject.toml` dejó de leer `requirements.txt` de forma dinámica. Comandos en [01](01-arquitectura.md) §9.
- **Tope de 20 min (D-15):** si no empaqueta o el arranque en frío es inaceptable, se pasa al plan B.

## 4. Frontend en Vercel

Astro con salida **estática** (sin adaptador SSR salvo que algo lo exija). `PUBLIC_API_URL` apunta a la api.
HTTPS es obligatorio para el micrófono; los previews de rama sirven para probarlo.

## 5. Plan B: contenedor

El mismo backend corre en un contenedor sin cambiar código; solo cambia `PUBLIC_API_URL`.
El `Dockerfile` (Python 3.12-slim, usuario sin privilegios) instala solo `requirements.txt`,
copia `src/`, `config/` y `data/` y arranca `uvicorn api.app_voice:app --app-dir src` en `${PORT:-8000}`;
`.dockerignore` deja fuera `.env`, `tests/`, `docs/` y `web/`. Las claves se pasan al ejecutar:
`docker build -t kognia-api .` y `docker run --rm -p 8000:8000 --env-file .env kognia-api`. Host:
cualquiera que ejecute un contenedor con el `Dockerfile` (Render, Railway u otro); no hay
infraestructura como código en el repo (D-23). Mantener una instancia caliente durante el jurado.

## 6. Producción, previews y la URL que se entrega

`main` despliega a **producción**; las ramas despliegan como *preview*. **En el formulario va la
URL de producción estable, nunca un preview** (RETO-E01). Se anota el ID del último despliegue
bueno para poder volver con *Instant Rollback* de Vercel.

### Autores de commits y el plan Hobby

En el plan **Hobby**, Vercel bloquea el despliegue cuando el autor del commit no es la cuenta
dueña del proyecto: según reportes de su comunidad, «Hobby no admite colaboración en repos
privados», y igualar los correos no lo arregla. Aquí hay dos autores. El repo es **público**
(verificado el 2026-10-09 con la API de GitHub), lo que en teoría evita el bloqueo: **se verifica
en G1 con un commit del otro autor (10 min)**, no se da por hecho. Si se bloquea, en este orden:
1. La dueña del proyecto de Vercel (Persona B, integradora) integra en `main` con commits de fusión propios (`git merge --no-ff`); no está confirmado que baste, se prueba.
2. Desplegar con `vercel deploy --prod` desde su equipo (la CLI aún no está instalada: `npm i -g vercel`).
3. Prueba de Pro, o transferir el proyecto a la cuenta de quien empuja.

Como el repo es público, **ningún commit puede llevar claves** (R-05): el `.env` está en `.gitignore`
y los secretos viven solo en las variables de Vercel.

## 7. `scripts/smoke_public.py` (carril B)

Contra la URL pública, sale con error si algo falla y imprime latencias:

1. `GET /health` → `status`, `contract`, motores configurados y estado de la fuente.
2. `POST /sessions` → token firmado.
3. `GET /dataset/brief` → coincide con los números esperados del corte ([09](09-datos-en-vivo-datos-gov-co.md) §9).
4. `POST /tools/aggregate_ips` (`provider_count`) → `status = ok` y `cache_status = live`.
5. `POST /realtime/session` para **cada motor** → credencial emitida (no se conecta).
6. Preflight CORS desde el origen del web.
7. `GET /` del web → 200 y el aviso de IA presente.

## 8. Runbook RETO-M07 (sin demo local; un único reintento de 2 min)

| Hora | Acción |
|---|---|
| 14:30 | Congelamiento; solo correcciones P0 acordadas |
| 15:00 | Candidato elegido; `smoke_public.py` en verde; escaneo de secretos |
| 15:25 | Calentar: abrir la URL, pedir el brief, probar ambos motores; `GET /health` |
| 15:30 | URL de producción y repo registrados en el formulario |
| Durante el jurado | Pestaña de respaldo abierta; si algo falla: `GET /health`, cambiar de motor (o de voz, a la del motor), *Instant Rollback* |

## 9. Secretos antes de abrir el repo (RETO-E02)

El repo debe ser público o con acceso a los jueces. Antes: revisar el **historial** (no solo el
árbol) con `git log -p` y búsquedas de patrones (`AIza`, `sk-`, `sk_car_`, `xai-`, `DATOS_GOV`, `.env`);
la extensión `security-guidance` ya corre en segundo plano. Si algo apareció, **revocar y rotar**
la clave (no basta con borrarla del último commit). Rotar las claves de la demo al terminar.

## 10. Costos y abuso (RETO-M06)

Los costos de API son del equipo. Configurar **topes de gasto y alertas** en las consolas de OpenAI
y Google; una demo de 10 minutos cuesta centavos, los ensayos también. La sesión anónima firmada
y los límites de tasa por token e IP evitan que un tercero use las claves (R-28).

**Cartesia (voz clonada, [08](08-contrato-voz-en-vivo.md) §15):** cobra 1 crédito por carácter sintetizado
(≈ 750–800 créditos por minuto de audio) y el plan Pro trae 100.000 créditos al mes y **3 síntesis
concurrentes** (precios publicados, leídos el 2026-10-09). Al agotarse los créditos o superar la
concurrencia, la interfaz degrada sola a la voz del motor. El navegador solo recibe un token de
10 min con alcance de síntesis; `/speech/session` tiene los mismos límites de tasa. Revisar el
consumo en la consola de Cartesia tras los ensayos y rotar la clave al terminar (§9).

## 11. Despliegue de prueba en Vercel desde el fork

Un solo proyecto (Services, §1) importado desde `GuzGuz0208/Agente_3D` (público). Simulado en
local el 2026-10-17: web compilada con `PUBLIC_API_URL=/api` detrás de un proxy con las reglas de
`vercel.json`; `/api/health` y una pregunta escrita con Gemini respondieron sin CORS.

1. vercel.com → **Add New… → Project** → importar `GuzGuz0208/Agente_3D` (si no aparece: *Adjust GitHub App Permissions* y dar acceso al repo).
2. **Framework Preset: Services** (lo detecta por `services` en `vercel.json`). **Root Directory: `./`** (no `web/`). No tocar build ni output: cada servicio los toma de `vercel.json`.
3. **Environment Variables** (antes de *Deploy*, para Production y Preview): tabla de abajo.
4. **Deploy.** Rama de producción: `main` (*Settings → Git → Production Branch*). Cada rama empujada sale como *preview*.
5. Los *previews* llevan **Vercel Authentication** por omisión: en el Android hay que iniciar sesión en Vercel con la cuenta dueña, o apagarla un rato en *Settings → Deployment Protection*. El dominio de producción (`<proyecto>.vercel.app`) es público.

| Variable | Obligatoria | Valor |
|---|---|---|
| `GEMINI_API_KEY` | Sí | secreto |
| `SESSION_SIGNING_KEY` | Sí (sin ella la API no arranca) | 32 bytes nuevos en hex (comando abajo) |
| `VOICE_DEFAULT_ENGINE` | No | `gemini` (día de la demo: `openai`) |
| `GEMINI_ACTIVITY_HANDLING` | No | `NO_INTERRUPTION` |
| `REALTIME_NOISE_REDUCTION` | No | `far_field` (solo OpenAI; `near_field` con audífonos) |
| `VOICE_REFRESH_TURNS` | No | `6` (renovación de contexto cada 6 turnos; `0` la apaga) |
| `DATOS_GOV_APP_TOKEN` | No | secreto (sin él, consultas anónimas) |
| `OPENAI_API_KEY` | Día de la demo | secreto |
| `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` | Día de la demo (voz clonada) | secreto / id de la voz |
| `ALLOWED_ORIGINS`, `PUBLIC_API_URL`, `API_PATH_PREFIX` | No: **no definir** | mismo dominio; la web se compila con `/api` |

```powershell
# SESSION_SIGNING_KEY nueva (PowerShell 5.1 o 7); no reutilizar la del .env local
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

**Verificar:** `Invoke-RestMethod https://<dominio>/api/health | ConvertTo-Json -Depth 4` →
`status: ok`, `default_engine: gemini`, `engines.gemini.configured: true`, `source.ok: true`. Luego
`https://<dominio>/consola/` en Chrome del Android: pregunta escrita, después «Usar mi voz».
Un 500 en `/api/health` casi siempre es `SESSION_SIGNING_KEY` ausente o corta (ver *Logs* del proyecto).

**Pasar a OpenAI el día de la demo:** *Settings → Environment Variables* → `VOICE_DEFAULT_ENGINE` =
`openai` (y `OPENAI_API_KEY`, `CARTESIA_*` presentes) → *Deployments* → último de producción → **⋯ →
Redeploy** (las variables solo aplican a despliegues nuevos). Comprobar en `/api/health`:
`default_engine: openai` y `engines.openai.configured: true`. Volver: `gemini` + *Redeploy*, o *Instant Rollback*.

## 12. Fase 2

La automatización del despliegue del contenedor y Twilio Media Streams (μ-law 8 kHz, un track por
hablante) quedan en el backlog ([13](13-diferenciadores-y-backlog.md), B-08 y B-09).
