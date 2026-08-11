// alethe-managed: v12
// Generado automáticamente por Alethe. Seguro editar — si cambias este
// archivo, elimina o altera la línea de arriba ("alethe-managed: vN") para
// impedir que Alethe sobrescriba tus cambios en versiones futuras.
//
// Mantiene .planning/ sincronizado solo, sin depender de que el modelo se
// acuerde de hacerlo. Estructura de planificación (6 archivos, siempre la
// misma, independientemente de la complejidad de la tarea):
//   - task.md        determinístico — checklist que refleja los todos.
//   - status.md      determinístico — "Status: <Completada|Planificación|En progreso>"
//                    + "Progress: <pct>%".
//   - progress.md    determinístico, SOLO ANEXA — historial cronológico de
//                    progreso, una entrada por cambio real.
//   - goal.md        solo la IA lo escribe (vía skill, en una SESIÓN-HIJA aislada).
//   - plan.md        solo la IA lo escribe (vía skill, ídem) — plan de
//                    implementación (lo QUE se hizo), sin pasos de test.
//   - procedure.json solo la IA lo escribe, pero vía TOOL dedicada
//                    (`gsd_record_step`), nunca texto suelto — un item por
//                    llamada, `{ description, category }`. Es esa lista
//                    estructurada la que se convierte en el checklist del
//                    "Briefing de Tests" en la Central de Merges (sin parsing
//                    de markdown, sin título/texto suelto que termine siendo
//                    un item marcable por error). Se reescribe desde cero en
//                    cada ciclo, igual que goal.md/plan.md.
//
// Cada archivo tiene exactamente UN escritor (determinístico O skill, nunca los
// dos) — no hay riesgo de que uno sobrescriba al otro, así que no hace falta
// merge textual.
//
// La skill corre en una SESIÓN-HIJA (client.session.create, SIN parentID — una
// sesión-hija vinculada vía parentID nace sin acceso al propio historial
// cuando se reabre después vía `--session <id>` en la TUI; sin parentID
// reanuda normalmente). Nace sin acceso al historial del padre de cualquier
// forma (confirmado empíricamente), así que el plugin empaqueta manualmente, en
// cada disparo, solo el DELTA de mensajes nuevos de la sesión principal desde
// la última sincronización.
//
// La sesión-hija es única y persistente por worktree — se crea una vez y se
// reutiliza en todo ciclo siguiente. El id queda grabado en
// `.planning/.gsd-child-session` (Alethe usa ese archivo para abrir un pane
// "GSD Sync" anexado vía `opencode --session <id>`), y
// `.planning/.gsd-child-busy` marca mientras está procesando.
//
// Modelo: cada ciclo intenta primero el MISMO modelo que la sesión principal
// acaba de usar (espejado, siempre automático) y, si falla, intenta en orden
// la cadena de fallback configurada globalmente en el app (leída en runtime
// de `.opencode/alethe-gsd-config.json`, escrito por Alethe en cada spawn).
// El fallo se detecta vía `session.error` (evento dedicado, confirmado
// empíricamente — no es una promise rechazada) seguido de `session.idle`;
// solo escribe `.planning/.gsd-child-error` si TODA la cadena se agota.
//
// Gatillo de la skill: al final de todo turno con actividad REAL desde el
// último aviso (session.idle DE LA SESIÓN PRINCIPAL + dirty) — `todowrite` O
// cualquier tool de trabajo (`write`/`edit`/`patch`/`bash`). `todowrite` solo
// no bastaba: solo dispara cuando el modelo decide armar la lista de tareas,
// lo que tiende a pasar solo en el primer pedido "grande" de la sesión —
// pedidos menores después (p. ej.: "agrega un .env.example") iban directo a
// `write` sin lista alguna y nunca disparaban sincronización.
//
// Validado empíricamente contra opencode 1.18.11 real (server mode, modelo
// gratuito) antes de embeberse en el binario de Alethe — ver
// docs/CHANGELOG.md.

import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { execFile } from 'node:child_process'
import { mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

type Todo = { content?: string; status?: string; priority?: string }
type ModelRef = { providerID: string; modelID: string }
type ProcedureCategory = 'setup' | 'action' | 'verify'
type ProcedureStep = { description: string; category: ProcedureCategory }

const PLANNING_DIR = '.planning'
const CHILD_SESSION_SENTINEL = '.gsd-child-session'
const CHILD_BUSY_SENTINEL = '.gsd-child-busy'
const CHILD_ERROR_SENTINEL = '.gsd-child-error'
const PROCEDURE_FILE = 'procedure.json'
const MODEL_CHAIN_CONFIG_PATH = '.opencode/alethe-gsd-config.json'
// Tools que indican trabajo real hecho (no solo lectura/investigación) — además
// de `todowrite`, cualquiera de estas también marca la sesión como "dirty" para
// disparar un ciclo GSD Sync nuevo, aunque no haya lista de tareas.
const WORK_SIGNAL_TOOLS = new Set(['write', 'edit', 'patch', 'bash'])

const SKILL_PROMPT = `Actualice los archivos de planificación de esta worktree:
1. .planning/goal.md — objetivo de esta tarea/sesión (lo que debe alcanzarse), cubriendo TODO el trabajo hecho en esta worktree hasta ahora — no solo la petición más reciente. Reescríbalo desde cero.
2. .planning/plan.md — plan paso a paso de lo que se hizo/se hará, cubriendo TODAS las tareas de esta worktree hasta ahora. NO incluya pasos de test/validación aquí — use la herramienta "gsd_record_step" para eso (punto 3).
3. Herramienta "gsd_record_step" — llámela UNA VEZ por CADA paso que un humano debe confirmar manualmente para validar TODO el trabajo de esta worktree hasta ahora (no solo la tarea más reciente), nunca una muestra. Cada llamada es un paso aislado y accionable.
ALCANCE Y PROPORCIONALIDAD (regla crítica para el procedimiento de test): el procedimiento cubre SOLO los archivos listados en la sección "Archivos modificados/creados en esta sesión" abajo — nunca invente pasos para probar rutas, comandos, servidores o archivos que no están en esa lista, aunque existan en el resto del proyecto. La cantidad y complejidad de los pasos refleja la complejidad REAL del cambio, nunca el tamaño de toda la app:
  - Cambio simple (p. ej.: crear/editar un archivo de documentación o configuración estática) → procedimiento simple, normalmente 1-2 pasos. Ejemplo: "action: abrir <archivo> y comprobar que existe en <ruta exacta>" + "verify: comprobar que el contenido tiene <estructura específica citada de verdad, p. ej. las secciones X/Y/Z>". NO ejecute servidores, NO pruebe APIs, NO abra nada fuera de lo modificado solo porque "podría ser relevante".
  - Cambio en código con efecto observable en runtime (ruta nueva, comportamiento de UI, lógica) → ahí cabe setup/action/verify con ejecución/interacción con el sistema, pero solo la parte que ESE cambio afecta específicamente — nunca un barrido general de la app.
IMPORTANTE: nunca afirme que algo "funciona" o "está correcto" — usted no lo verificó, solo implementó/planeó. La confirmación de que funcionó o no es siempre del usuario.
IMPORTANTE: el resumen de la conversación abajo es solo contexto de alto nivel, no es fuente confiable para detalles exactos. Antes de llamar a "gsd_record_step" con un paso que cite un texto específico (mensaje de error, salida de consola, nombre de comando, formato de dato), ABRA y relea el archivo real para copiar el texto exacto de ahí — nunca escriba de memoria ni por suposición/inferencia de lo que "probablemente" hace el código. Si no puede confirmar un detalle leyendo el código, describa el paso en términos generales en lugar de inventar un texto específico.
NO escriba en .planning/status.md, .planning/task.md ni .planning/progress.md — esos se mantienen automáticamente por otro proceso, fuera de su control.
No implemente ni corrija nada ahora — solo documente/registre.

Contexto de la sesión principal (delta desde la última sincronización) sigue abajo, si lo hay — es solo un resumen en texto suelto de la conversación, no confíe en él para detalles exactos de código.`

/** Un archivo queda excluido del alcance del procedimiento si es
 *  infraestructura del propio Alethe (`.planning/` — estado de este plugin —
 *  y `.opencode/`/`opencode.json`, escritos automáticamente en cada spawn:
 *  plugin GSD, MCP de Graphify) — ninguno de los dos es trabajo real del
 *  usuario en esta sesión; sin esta exclusión la sesión-hija veía esos
 *  archivos en `git status`/`git diff` e inventaba pasos de test para
 *  "validar que el plugin carga", desconectado de la tarea real. */
function isRealWork(f: string): boolean {
  return Boolean(f) && !f.startsWith(`${PLANNING_DIR}/`) && !f.startsWith('.opencode/') && f !== 'opencode.json'
}

/** Archivos ya COMMITEADOS en esta worktree desde que la rama divergió de
 *  `main`/`master` — complementa `getChangedFiles` (que solo ve working tree)
 *  con trabajo de ciclos anteriores que ya se commiteó (merge parcial,
 *  commit manual del usuario) en el medio. Sin esto, `clearProcedure`
 *  vaciando `procedure.json` en cada ciclo (ver comentario al inicio del
 *  archivo) haría que el paso de validación de ese trabajo se perdiera de
 *  verdad — desaparece de `git status` apenas se commitea, y la regla de
 *  alcance del prompt de abajo prohíbe inventar pasos para archivos fuera de
 *  la lista. Best-effort: sin `main`/`master` resoluble, devuelve lista
 *  vacía — no bloquea el ciclo. */
async function getCommittedFilesSinceBase(root: string): Promise<string[]> {
  for (const base of ['main', 'master']) {
    try {
      const { stdout: mergeBaseOut } = await execFileAsync('git', ['merge-base', 'HEAD', base], { cwd: root })
      const mergeBase = mergeBaseOut.trim()
      if (!mergeBase) continue
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${mergeBase}..HEAD`], { cwd: root })
      return stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    } catch {
      // la base no existe localmente o merge-base falló — intenta la siguiente
    }
  }
  return []
}

/** Lista archivos modificados/creados/commiteados en esta worktree — une el
 *  working tree (`git status --porcelain`, cubre lo no commiteado) con el
 *  historial de commits desde la base de la rama (`getCommittedFilesSinceBase`,
 *  cubre lo commiteado). Fuente de verdad sobre QUÉ cambió de verdad en esta
 *  worktree, para instruir a la sesión-hija a releer exactamente esos archivos
 *  en lugar de confiar solo en el resumen en prosa de la conversación (que
 *  nunca tiene detalle exacto suficiente para escribir validación precisa). */
async function getChangedFiles(root: string): Promise<string[]> {
  let uncommitted: string[] = []
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: root })
    uncommitted = stdout.split('\n').map((line) => line.slice(3).trim())
  } catch {
    // sin git/fuera de un repo — sigue solo con lo que getCommittedFilesSinceBase encuentre
  }
  const committed = await getCommittedFilesSinceBase(root)
  const all = new Set([...uncommitted, ...committed].filter(isRealWork))
  return [...all]
}

function renderTask(todos: Todo[]): string {
  return todos.map((t) => `- [${t.status === 'completed' ? 'x' : ' '}] ${(t.content ?? '').trim()}`).join('\n') + '\n'
}

function renderStatus(total: number, completed: number): string {
  const label = completed === total ? 'Completada' : completed === 0 ? 'Planificación' : 'En progreso'
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  return `Status: ${label}\nProgress: ${progress}%\n`
}

function renderProgressEntry(total: number, completed: number): string {
  const stamp = new Date().toISOString()
  return `## ${stamp}\n\nProgreso actualizado: ${completed}/${total} tareas completadas.\n\n`
}

/** Extrae texto legible de las `parts` de un mensaje (`session.messages`),
 *  ignorando partes no-texto (step-start/step-finish/tool-call etc.). */
function extractMessageText(message: any): string {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return parts
    .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text.trim())
    .filter(Boolean)
    .join('\n')
}

/** `providerID`/`modelID` del último mensaje del asistente — el modelo que la
 *  sesión principal acaba de usar con éxito, "conocido bueno" por
 *  construcción. `null` si la sesión todavía no tiene ninguna respuesta. */
function extractMirroredModel(messages: any[]): ModelRef | null {
  const lastAssistant = [...messages].reverse().find((m) => m?.info?.role === 'assistant')
  const providerID = lastAssistant?.info?.providerID
  const modelID = lastAssistant?.info?.modelID
  return typeof providerID === 'string' && typeof modelID === 'string' ? { providerID, modelID } : null
}

export const AletheGsdStatePlugin: Plugin = async ({ directory, worktree, client }) => {
  const root = (worktree as string | undefined) ?? directory
  const planningDir = join(root, PLANNING_DIR)
  let lastTask = ''
  // Hubo todowrite desde el último aviso al usuario/skill — dispara en el
  // próximo session.idle de la sesión principal.
  let dirty = false
  // Sesión-hija actual (cacheada después de leerse/crearse una vez).
  let childSessionId: string | null = null
  // Mientras true, ignora todowrite (probablemente es la sesión-hija
  // documentando su propio trabajo, no el plan del agente principal) —
  // fallback seguro en caso de que el hook de tool no exponga de qué sesión
  // vino. También true durante toda la cadena de intentos de modelo (no solo
  // el 1º).
  let childBusy = false
  // Cursor de delta: nº de mensajes de la sesión principal ya enviados a la
  // sesión-hija.
  let lastSyncedMessageCount = 0
  // Todos de un `todowrite` que llegó mientras `childBusy` era true — sin
  // esto, ese todowrite se descartaba en silencio (ni task.md/status.md se
  // actualizaban, ni se agendaba un ciclo nuevo). Si era el ÚLTIMO todowrite
  // de la sesión principal, status.md quedaba trabado en "En progreso" para
  // siempre, trabando el Gate de Conclusión de Planificación en la Central de
  // Merges. Se vacía apenas termina el ciclo actual de la sesión-hija
  // (`setChildBusy(false)`).
  let pendingTodos: Todo[] | null = null

  // Estado de la cadena de fallback en curso (solo existe durante un ciclo).
  let activeChain: ModelRef[] = []
  let activeChainIndex = 0
  let activePromptText = ''
  let attemptFailed = false
  let lastAttemptErrorMessage = ''

  // Reconciliación de boot: `.gsd-child-busy` solo se limpia con
  // `setChildBusy(false)`, llamado cuando ESTE proceso detecta
  // `session.idle`/`session.error` de la sesión-hija. Si el proceso muere en
  // medio de un ciclo (pane cerrado, app reiniciada, bloqueo del modelo) sin
  // pasar por ahí, el sentinel queda huérfano en disco para siempre — la UI
  // (que solo lee el archivo, nunca reconstruye estado del proceso antiguo)
  // muestra "Sincronizando" eternamente aunque no esté corriendo nada de
  // verdad. Una instancia del plugin que está arrancando ahora no tiene
  // `activeChain` ninguna todavía (línea de arriba, siempre vacía en el boot),
  // así que cualquier sentinel preexistente es necesariamente huérfano de un
  // proceso anterior — nunca del propio.
  void rm(join(planningDir, CHILD_BUSY_SENTINEL), { force: true }).catch(() => {})

  async function syncStructure(todos: Todo[]) {
    if (!Array.isArray(todos) || todos.length === 0) return // nunca inventa progreso sin ningún todo real
    await mkdir(planningDir, { recursive: true }).catch(() => {})
    const completed = todos.filter((t) => t.status === 'completed').length
    const total = todos.length
    const nextTask = renderTask(todos)
    if (nextTask !== lastTask) {
      await writeFile(join(planningDir, 'task.md'), nextTask, 'utf8').catch(() => {})
      await writeFile(join(planningDir, 'status.md'), renderStatus(total, completed), 'utf8').catch(() => {})
      await appendFile(join(planningDir, 'progress.md'), renderProgressEntry(total, completed), 'utf8').catch(() => {})
      lastTask = nextTask
    }
  }

  async function getOrCreateChildSession(mainSessionId: string): Promise<string | null> {
    if (childSessionId) return childSessionId
    const sentinelPath = join(planningDir, CHILD_SESSION_SENTINEL)
    const existing = await readFile(sentinelPath, 'utf8').then((s) => s.trim()).catch(() => '')
    if (existing) {
      childSessionId = existing
      return childSessionId
    }
    try {
      // SIN parentID — ver nota en el encabezado del archivo sobre por qué una
      // sesión-hija vinculada no reanudaba con historial visible en la TUI.
      const created: any = await (client as any).session.create({
        body: { directory: root, title: 'Alethe · GSD Sync' },
      })
      const id: string | undefined = created?.data?.id ?? created?.id
      if (!id) return null
      childSessionId = id
      await mkdir(planningDir, { recursive: true }).catch(() => {})
      await writeFile(sentinelPath, id, 'utf8').catch(() => {})
      return id
    } catch {
      return null
    }
  }

  async function buildContextDeltaAndMirror(mainSessionId: string): Promise<{ delta: string; mirrored: ModelRef | null }> {
    try {
      const res: any = await (client as any).session.messages({ path: { id: mainSessionId } })
      const all: any[] = Array.isArray(res?.data) ? res.data : []
      const mirrored = extractMirroredModel(all)
      const delta = all.slice(lastSyncedMessageCount)
      lastSyncedMessageCount = all.length
      const rendered = delta
        .map((m) => {
          const role = m?.info?.role ?? 'unknown'
          const text = extractMessageText(m)
          return text ? `[${role}] ${text}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
      return { delta: rendered, mirrored }
    } catch {
      return { delta: '', mirrored: null }
    }
  }

  /** Cadena efectiva: modelo espejado (posición 0, siempre intentado primero,
   *  automático) + cadena de fallback configurada globalmente en el app (leída
   *  en runtime — cambia sin necesidad de una versión nueva del plugin). */
  async function buildEffectiveChain(mirrored: ModelRef | null): Promise<ModelRef[]> {
    const chain: ModelRef[] = []
    if (mirrored) chain.push(mirrored)
    try {
      const raw = await readFile(join(root, MODEL_CHAIN_CONFIG_PATH), 'utf8')
      const parsed = JSON.parse(raw)
      const configured: unknown[] = Array.isArray(parsed?.modelChain) ? parsed.modelChain : []
      for (const modelID of configured) {
        if (typeof modelID === 'string' && modelID.trim()) {
          chain.push({ providerID: 'opencode', modelID: modelID.trim() })
        }
      }
    } catch {
      // sin config/error de parse — sigue solo con el modelo espejado, si lo hay
    }
    return chain
  }

  /** Vacía `.planning/procedure.json` al inicio de cada ciclo nuevo — la
   *  sesión-hija reconstruye la lista completa vía `gsd_record_step` (mismo
   *  espíritu de "reescribe desde cero" de goal.md/plan.md), así nunca mezcla
   *  pasos de una tarea antigua ya removida/cambiada con el ciclo actual. */
  async function clearProcedure() {
    await mkdir(planningDir, { recursive: true }).catch(() => {})
    await writeFile(join(planningDir, PROCEDURE_FILE), '[]', 'utf8').catch(() => {})
  }

  /** Agrega un paso en `.planning/procedure.json` (lee-modifica-escribe
   *  — solo la tool `gsd_record_step` llama esto, nunca concurrente con sí
   *  misma dentro del mismo ciclo, ya que cada tool call del modelo espera a
   *  que la anterior termine). */
  async function appendProcedureStep(step: ProcedureStep) {
    const path = join(planningDir, PROCEDURE_FILE)
    const current: unknown = await readFile(path, 'utf8').then((s) => JSON.parse(s)).catch(() => [])
    const next = Array.isArray(current) ? current : []
    next.push(step)
    await mkdir(planningDir, { recursive: true }).catch(() => {})
    await writeFile(path, JSON.stringify(next, null, 2), 'utf8').catch(() => {})
  }

  async function setChildBusy(busy: boolean) {
    childBusy = busy
    const sentinelPath = join(planningDir, CHILD_BUSY_SENTINEL)
    if (busy) {
      await mkdir(planningDir, { recursive: true }).catch(() => {})
      await writeFile(sentinelPath, '1', 'utf8').catch(() => {})
    } else {
      await rm(sentinelPath, { force: true }).catch(() => {})
      if (pendingTodos) {
        const todos = pendingTodos
        pendingTodos = null
        await syncStructure(todos)
      }
    }
  }

  async function writeChildError(message: string) {
    await mkdir(planningDir, { recursive: true }).catch(() => {})
    await writeFile(join(planningDir, CHILD_ERROR_SENTINEL), message, 'utf8').catch(() => {})
  }

  /** Intenta el modelo actual de `activeChain[activeChainIndex]`. Un fallo
   *  INMEDIATO (schema inválido, error de red — viene en el propio retorno de
   *  `promptAsync`, no es una promise rechazada) avanza al siguiente intento
   *  directo, sin esperar evento alguno (nada llegó a dispararse). El fallo
   *  en runtime (modelo válido en el schema pero inexistente/indisponible)
   *  solo aparece después, vía `session.error` + `session.idle` desde afuera
   *  de esta función. */
  async function sendChainAttempt(childId: string) {
    const model = activeChain[activeChainIndex]
    const res: any = await (client as any).session
      .promptAsync({ path: { id: childId }, body: { parts: [{ type: 'text', text: activePromptText }], model } })
      .catch((e: any) => ({ error: { data: { message: e?.message ?? String(e) } } }))
    if (res?.error) {
      const msg = res.error?.data?.message ?? res.error?.name ?? 'unknown error'
      await advanceChainOrGiveUp(childId, msg)
    }
    // sin error inmediato — espera session.error/session.idle normalmente
  }

  async function advanceChainOrGiveUp(childId: string, errorMessage: string) {
    activeChainIndex += 1
    if (activeChainIndex < activeChain.length) {
      await sendChainAttempt(childId)
      return
    }
    await writeChildError(
      `Todos los ${activeChain.length} modelo(s) de la cadena fallaron. Último error: ${errorMessage}`,
    )
    await setChildBusy(false)
    activeChain = []
    activeChainIndex = 0
  }

  return {
    tool: {
      gsd_record_step: tool({
        description:
          'Registra UN paso de test real que un humano debe confirmar manualmente para validar el trabajo de esta worktree — nunca escriba pasos de test como texto suelto en plan.md, use siempre esta herramienta, una llamada por paso. Alcance estricto: solo los archivos modificados/creados EN ESTA sesión, proporcional a la complejidad real del cambio — nunca invente pasos para probar partes de la app que no se tocaron.',
        args: {
          description: z
            .string()
            .describe('El paso en sí, en español, accionable (p. ej.: "Ejecutar npm run users y comprobar que la lista aparece") — copie textos exactos (mensajes/comandos) del código real, nunca invente. Para cambios simples (p. ej.: un archivo de documentación), un paso del tipo "abrir <archivo> y comprobar <estructura esperada>" ya es suficiente — no infle con tests de partes de la app no modificadas.'),
          category: z
            .enum(['setup', 'action', 'verify'])
            .describe('setup = preparación necesaria antes de probar; action = ejecución de la propia prueba; verify = qué comprobar en el resultado'),
        },
        async execute(args) {
          await appendProcedureStep({ description: args.description, category: args.category })
          return { output: `Paso registrado: [${args.category}] ${args.description}` }
        },
      }),
    },
    'tool.execute.after': async (input) => {
      const toolName = (input as { tool?: string }).tool
      if (childBusy) {
        // Probable tool call de la sesión-hija, no del agente principal — pero
        // si es un todowrite de verdad del agente principal llegando en el
        // medio, represa los todos en lugar de descartarlos (ver comentario
        // de `pendingTodos`). Queda pendiente hasta que el ciclo actual termine.
        if (toolName === 'todowrite') {
          pendingTodos = ((input as { args?: { todos?: Todo[] } }).args?.todos ?? []) as Todo[]
          dirty = true
        }
        return
      }
      if (toolName === 'todowrite') {
        const todos = ((input as { args?: { todos?: Todo[] } }).args?.todos ?? []) as Todo[]
        await syncStructure(todos)
        dirty = true
        return
      }
      // Trabajo real sin lista de tareas: `todowrite` solo dispara cuando el
      // modelo decide que la tarea "merece" una lista — pedidos pequeños
      // después del primer grande de la sesión (p. ej.: "agrega un .env.example")
      // suelen saltearse eso e ir directo a `write`/`edit`/`bash`, dejando ese
      // trabajo fuera del ciclo GSD Sync para siempre. Contar estas tools
      // también garantiza que CUALQUIER trabajo real de la sesión — no solo
      // el primer pedido "grande" — dispare sincronización.
      if (toolName && WORK_SIGNAL_TOOLS.has(toolName)) {
        dirty = true
      }
    },
    event: async ({ event }) => {
      const sessionID = (event.properties as { sessionID?: string } | undefined)?.sessionID
      if (!sessionID) return

      if (event.type === 'session.error' && sessionID === childSessionId) {
        const error = (event.properties as any)?.error
        lastAttemptErrorMessage = error?.data?.message ?? error?.name ?? 'unknown error'
        attemptFailed = true
        return
      }

      if (event.type !== 'session.idle') return

      // Sesión-hija quedó ociosa — o terminó el intento actual con éxito, o
      // falló (señalizado por session.error justo antes).
      if (sessionID === childSessionId) {
        if (attemptFailed) {
          attemptFailed = false
          await advanceChainOrGiveUp(sessionID, lastAttemptErrorMessage)
          return
        }
        if (activeChain.length > 0) {
          // éxito — cierra el ciclo
          await setChildBusy(false)
          activeChain = []
          activeChainIndex = 0
        }
        return
      }

      // session.idle de cualquier otra sesión que no sea la principal
      // (child todavía no conocido) — solo la sesión principal, cuando dirty,
      // dispara un ciclo nuevo.
      if (!dirty) return
      dirty = false

      const childId = await getOrCreateChildSession(sessionID)
      if (!childId) return

      const { delta, mirrored } = await buildContextDeltaAndMirror(sessionID)
      const chain = await buildEffectiveChain(mirrored)
      if (chain.length === 0) return // sesión principal aún sin ninguna respuesta — no hay modelo para espejar

      const changedFiles = await getChangedFiles(root)
      const filesSection = changedFiles.length > 0
        ? `\n\nArchivos modificados/creados en esta sesión (git status — fuente de verdad, relea CADA uno antes de escribir el plan):\n${changedFiles.map((f) => `- ${f}`).join('\n')}`
        : ''

      await clearProcedure()

      activeChain = chain
      activeChainIndex = 0
      activePromptText = (delta ? `${SKILL_PROMPT}\n\n---\n${delta}\n---` : SKILL_PROMPT) + filesSection

      await setChildBusy(true)
      await sendChainAttempt(childId)
    },
  }
}
