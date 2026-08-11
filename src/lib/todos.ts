import type { MessageKey } from './i18n'
import type { TodoItem } from './types'

export const TODO_TITLE_MAX_LENGTH = 200
export const TODO_TAG_MAX_LENGTH = 24

export const DEFAULT_TODO_KEYS = [
  'todo.defaultReviewWorkspace',
  'todo.defaultOpenReadme',
  'todo.defaultPlanNextStep',
] as const

export const DEFAULT_TODOS: Omit<TodoItem, 'id'>[] = [
  { title: DEFAULT_TODO_KEYS[0], completed: false, tags: ['review'] },
  { title: DEFAULT_TODO_KEYS[1], completed: false, tags: ['docs'] },
  { title: DEFAULT_TODO_KEYS[2], completed: false, tags: ['plan'] },
]

/** Resolve a default todo title key to its translated text. */
export function translateDefaultTodoTitle(title: string, t: (key: MessageKey) => string): string {
  if ((DEFAULT_TODO_KEYS as readonly string[]).includes(title)) return t(title as MessageKey)
  return title
}

export function normalizeTodoTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, TODO_TITLE_MAX_LENGTH)
}

export function normalizeTodoTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,#\s]+/) : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item
      .trim()
      .replace(/^#+/, '')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .slice(0, TODO_TAG_MAX_LENGTH)
      .toLowerCase()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags.slice(0, 6)
}

/** Reordena somente dentro da mesma seção (ativa ou concluída). */
export function reorderTodoItems(
  items: TodoItem[],
  draggedId: string,
  targetId: string,
): TodoItem[] {
  if (draggedId === targetId) return items
  const fromIndex = items.findIndex((item) => item.id === draggedId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (fromIndex === -1 || targetIndex === -1) return items
  if (items[fromIndex].completed !== items[targetIndex].completed) return items

  const next = [...items]
  const [dragged] = next.splice(fromIndex, 1)
  const adjustedTarget = next.findIndex((item) => item.id === targetId)
  next.splice(adjustedTarget, 0, dragged)
  return next
}
