export type Question = { question: string; options: string[] }

export type Answer =
  | { kind: 'option'; value: string }
  | { kind: 'other'; value: string }
  | { kind: 'skip' }

export type Rewrite = { text: string; added: string[] }

export type Step =
  | 'compose'
  | 'reading'
  | 'questions'
  | 'rewriting'
  | 'review'
  | 'error'

export type FlowError = { stage: 'reading' | 'rewriting'; message: string }

export type Flow = {
  id: string
  /** Bumped each time a model call starts; a reply for an older run is dropped. */
  run: number
  step: Step
  original: string
  questions: Question[]
  answers: (Answer | null)[]
  otherOpen: number | null
  rewrite: Rewrite | null
  error: FlowError | null
  editing: boolean
  copied: boolean
  note: string | null
  historyId: string | null
}

export type HistoryEntry = {
  id: string
  at: number
  original: string
  upgraded: string
  added: string[]
}

export type View = 'flow' | 'history'

declare module 'claude-code' {
  interface PluginState {
    'prompt-upgrade': {
      flow: Flow | null
      auto: boolean
      history: HistoryEntry[]
      view: View
    }
  }
}
