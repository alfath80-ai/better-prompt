import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Flow, HistoryEntry, View } from '../types'
import {
  QUESTIONS_SYSTEM,
  REWRITE_SYSTEM,
  parseQuestions,
  parseRewrite,
  questionsPrompt,
  rewritePrompt,
  route,
} from './logic'
import { drawPane } from './view'
import type { Actions, Els } from './view'

const PANE = 'prompt-upgrade'
const TITLE = 'Prompt Upgrade'
const KEEP = 20
const QUESTIONS_MODEL = 'haiku'
const REWRITE_MODEL = 'sonnet'

const flowAtom = atom({ plugin: 'prompt-upgrade', key: 'flow' } as const, null)
const autoAtom = atom({ plugin: 'prompt-upgrade', key: 'auto' } as const, false)
const historyAtom = atom({ plugin: 'prompt-upgrade', key: 'history' } as const, [])
const viewAtom = atom({ plugin: 'prompt-upgrade', key: 'view' } as const, 'flow' as View)

type Dollar = EngineInterface

let serial = 0
function newId(): string {
  serial += 1

  return `${Date.now().toString(36)}-${serial}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

function freshFlow(original: string, step: Flow['step']): Flow {
  return {
    id: newId(),
    run: 0,
    step,
    original,
    questions: [],
    answers: [],
    otherOpen: null,
    rewrite: null,
    error: null,
    editing: false,
    copied: false,
    note: null,
    historyId: null,
  }
}

function failure(reason: string, status?: number): string {
  switch (reason) {
    case 'aborted':
      return 'The request took too long and was stopped.'
    case 'empty-reply':
      return 'The model sent back an empty reply.'
    case 'api-error':
      return status === undefined
        ? 'The model service answered with an error.'
        : `The model service answered with an error (status ${status}).`
    default:
      return reason
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------- the flow

/** Sets the flow, keeping it only if it is still the one with `id` at `run`. */
async function patch(
  $: Dollar,
  id: string,
  run: number | null,
  change: (flow: Flow) => Flow,
): Promise<boolean> {
  let isApplied = false
  await update($, flowAtom, flow => {
    if (flow === null || flow.id !== id || (run !== null && flow.run !== run)) {
      isApplied = false

      return flow
    }
    isApplied = true

    return change(flow)
  })

  return isApplied
}

/** Starts a model step: bumps the run so a late reply from an earlier one is dropped. */
async function startRun($: Dollar, step: 'reading' | 'rewriting'): Promise<Flow | null> {
  let started: Flow | null = null
  await update($, flowAtom, flow => {
    if (flow === null) return flow
    started = { ...flow, step, run: flow.run + 1, error: null }

    return started
  })

  return started
}

async function askQuestions($: Dollar): Promise<void> {
  const flow = await startRun($, 'reading')
  if (flow === null) return
  const { id, run } = flow
  try {
    const reply = await $.model.complete({
      model: QUESTIONS_MODEL,
      system: QUESTIONS_SYSTEM,
      prompt: questionsPrompt(flow.original),
      maxTokens: 800,
      timeoutMs: 60_000,
    })
    if (!reply.isAnswered) {
      const status = 'status' in reply ? reply.status : undefined
      await patch($, id, run, one => ({
        ...one,
        step: 'error',
        error: { stage: 'reading', message: failure(reply.reason, status) },
      }))

      return
    }
    const questions = parseQuestions(reply.text)
    if (questions.length === 0) {
      // Nothing would help: straight to the rewrite.
      const isOurs = await patch($, id, run, one => ({ ...one, questions: [], answers: [] }))
      if (isOurs) await writeRewrite($)

      return
    }
    await patch($, id, run, one => ({
      ...one,
      step: 'questions',
      questions,
      answers: questions.map(() => null),
      otherOpen: null,
    }))
  } catch (error) {
    await patch($, id, run, one => ({
      ...one,
      step: 'error',
      error: { stage: 'reading', message: messageOf(error) },
    }))
  }
}

async function writeRewrite($: Dollar): Promise<void> {
  const flow = await startRun($, 'rewriting')
  if (flow === null) return
  const { id, run } = flow
  try {
    const reply = await $.model.complete({
      model: REWRITE_MODEL,
      system: REWRITE_SYSTEM,
      prompt: rewritePrompt(flow.original, flow.questions, flow.answers),
      maxTokens: 2000,
      timeoutMs: 120_000,
    })
    const rewrite = reply.isAnswered ? parseRewrite(reply.text) : undefined
    if (rewrite === undefined) {
      const message = reply.isAnswered
        ? 'The model sent back an empty reply.'
        : failure(reply.reason, 'status' in reply ? reply.status : undefined)
      await patch($, id, run, one => ({ ...one, step: 'error', error: { stage: 'rewriting', message } }))

      return
    }
    const entry: HistoryEntry = {
      id: newId(),
      at: Date.now(),
      original: flow.original,
      upgraded: rewrite.text,
      added: rewrite.added,
    }
    const isOurs = await patch($, id, run, one => ({
      ...one,
      step: 'review',
      rewrite,
      editing: false,
      copied: false,
      note: null,
      historyId: entry.id,
    }))
    if (isOurs) await remember($, entry)
  } catch (error) {
    await patch($, id, run, one => ({
      ...one,
      step: 'error',
      error: { stage: 'rewriting', message: messageOf(error) },
    }))
  }
}

async function remember($: Dollar, entry: HistoryEntry): Promise<void> {
  const list = await update($, historyAtom, items => [...items.filter(one => one.id !== entry.id), entry].slice(-KEEP))
  await $.store.set('history', list)
}

/**
 * Opens the pane. Where it cannot be placed, the flow ends, the words go back
 * in the prompt box, and the answer is false.
 */
async function openPane($: Dollar): Promise<{ isPlaced: boolean; reason?: string }> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, rows: 30 })
  if (opened.isPlaced) return { isPlaced: true }

  const flow = await read($, flowAtom)
  await update($, flowAtom, () => null)
  await $.ui.close({ id: PANE })
  if (flow !== null && flow.original.trim() !== '') {
    await $.prompt.fill({ text: flow.original })
  }

  return { isPlaced: false, reason: opened.reason }
}

const NARROW = 'The window is too narrow for the Prompt Upgrade pane, so your prompt is back in the prompt box.'

/** Ends the flow and the pane; what was in progress is dropped. */
async function finish($: Dollar): Promise<void> {
  draft = null
  await update($, flowAtom, () => null)
  await update($, viewAtom, () => 'flow' as View)
  await $.ui.close({ id: PANE })
}

/** Sends text as the person's own prompt; it arrives with a plugin origin, so `route` lets it through. */
async function send($: Dollar, text: string): Promise<void> {
  await finish($)
  if (text.trim() !== '') await $.prompt.submit({ text, asUser: true })
}

async function cancel($: Dollar): Promise<void> {
  const flow = await read($, flowAtom)
  await finish($)
  if (flow !== null && flow.original.trim() !== '') {
    await $.prompt.fill({ text: flow.original })
  }
}

/** Starts an upgrade of `original`; an upgrade already in progress goes back to the prompt box. */
async function begin($: Dollar, original: string, step: 'reading' | 'compose'): Promise<void> {
  const before = await read($, flowAtom)
  draft = null
  await update($, flowAtom, () => freshFlow(original, step))
  await update($, viewAtom, () => 'flow' as View)
  if (before !== null && before.step !== 'review' && before.original.trim() !== '' && before.original !== original) {
    await $.prompt.fill({ text: before.original })
  }
}

// The text the person typed into Edit; kept only for this load of the module.
let draft: string | null = null

function actions($: Dollar, flow: Flow | null): Actions {
  const id = flow?.id ?? ''
  const guard = (work: () => Promise<unknown>) => () => {
    void work().catch(error => $.ui.log(`Prompt Upgrade: ${messageOf(error)}`))
  }

  return {
    answer: (index, value) =>
      guard(() =>
        patch($, id, null, one => ({
          ...one,
          answers: one.answers.map((answer, at) => (at === index ? { kind: 'option', value } : answer)),
          otherOpen: one.otherOpen === index ? null : one.otherOpen,
        })),
      )(),
    other: index => guard(() => patch($, id, null, one => ({ ...one, otherOpen: index })))(),
    otherText: (index, value) =>
      guard(() =>
        patch($, id, null, one => ({
          ...one,
          answers: one.answers.map((answer, at) =>
            at === index ? (value.trim() === '' ? null : { kind: 'other', value: value.trim() }) : answer,
          ),
          otherOpen: null,
        })),
      )(),
    skip: index =>
      guard(() =>
        patch($, id, null, one => ({
          ...one,
          answers: one.answers.map((answer, at) => (at === index ? { kind: 'skip' } : answer)),
          otherOpen: one.otherOpen === index ? null : one.otherOpen,
        })),
      )(),
    upgrade: guard(() => writeRewrite($)),
    run: guard(async () => {
      const current = await read($, flowAtom)
      const text = current?.editing === true && draft !== null ? draft : (current?.rewrite?.text ?? '')
      await send($, text)
    }),
    runText: value => guard(() => send($, value))(),
    draft: value => {
      draft = value
    },
    edit: guard(async () => {
      draft = null
      await patch($, id, null, one => ({ ...one, editing: true, copied: false, note: null }))
    }),
    doneEditing: guard(async () => {
      const text = draft
      draft = null
      await patch($, id, null, one => ({
        ...one,
        editing: false,
        rewrite: one.rewrite === null || text === null || text.trim() === '' ? one.rewrite : { ...one.rewrite, text },
      }))
    }),
    copy: surface =>
      guard(async () => {
        const current = await read($, flowAtom)
        const text = current?.rewrite?.text ?? ''
        const copied = await $.ui.copy({ text, surface })
        await patch($, id, null, one =>
          copied.isCopied
            ? { ...one, copied: true, note: null }
            : { ...one, copied: false, note: `Could not copy here (${copied.reason}). Select the text in the card instead.` },
        )
      })(),
    cancel: guard(() => cancel($)),
    retry: guard(async () => {
      const current = await read($, flowAtom)
      if (current?.error?.stage === 'rewriting') await writeRewrite($)
      else await askQuestions($)
    }),
    sendOriginal: guard(async () => {
      const current = await read($, flowAtom)
      await send($, current?.original ?? '')
    }),
    compose: value =>
      guard(async () => {
        const text = value.trim()
        if (text === '') return
        await patch($, id, null, one => ({ ...one, original: text }))
        await askQuestions($)
      })(),
    openHistory: entryId =>
      guard(async () => {
        const list = await read($, historyAtom)
        const entry = list.find(one => one.id === entryId)
        if (entry === undefined) return
        await begin($, entry.original, 'reading')
        await update($, flowAtom, one =>
          one === null
            ? one
            : {
                ...one,
                step: 'review',
                rewrite: { text: entry.upgraded, added: entry.added },
                historyId: entry.id,
              },
        )
      })(),
    back: guard(async () => {
      const current = await read($, flowAtom)
      if (current === null) await finish($)
      else await update($, viewAtom, () => 'flow' as View)
    }),
  }
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'better',
        description: 'Upgrade a rough prompt before it is sent (on, off, history)',
        argumentHint: '[prompt | on | off | history]',
      })
      const storedAuto = await $.store.get('auto')
      const storedHistory = await $.store.get('history')
      await update($, autoAtom, () => storedAuto === true)
      if (Array.isArray(storedHistory)) {
        await update($, historyAtom, () => (storedHistory as HistoryEntry[]).slice(-KEEP))
      }

      // A reload mid-step: show the pane again and pick the step back up.
      const flow = await read($, flowAtom)
      if (flow !== null) {
        const panes = await $.ui.panes()
        if (!panes.some(pane => pane.id === PANE)) {
          void $.ui.open({ id: PANE, title: TITLE, rows: 30 })
        }
        if (flow.step === 'reading') void askQuestions($)
        if (flow.step === 'rewriting') void writeRewrite($)
      }
    } catch (error) {
      $.ui.log(`Prompt Upgrade could not start: ${messageOf(error)}`, { to: 'debug' })
    }

    return next(e)
  })

  on('command.run', { command: 'better' }, async ($, e) => {
    try {
      const args = e.args.trim()
      const word = args.toLowerCase()

      if (word === 'on' || word === 'off') {
        const isAuto = word === 'on'
        await update($, autoAtom, () => isAuto)
        await $.store.set('auto', isAuto)

        return {
          text: isAuto
            ? 'Prompt Upgrade automatic mode is on. Prompts you type open in the pane first; start one with > to send it as is.'
            : 'Prompt Upgrade automatic mode is off. Prompts you type are sent as usual.',
        }
      }

      if (word === 'history') {
        const list = await read($, historyAtom)
        await update($, viewAtom, () => 'history' as View)
        // Answer first; the pane opens in the background.
        void $.ui.open({ id: PANE, title: TITLE, focus: true, rows: 30 }).catch(() => undefined)

        return {
          text:
            list.length === 0
              ? 'No upgrades yet. Your last 20 will show in the pane.'
              : `Showing your last ${list.length} upgrade${list.length === 1 ? '' : 's'} in the pane.`,
        }
      }

      await begin($, args, args === '' ? 'compose' : 'reading')
      void (async () => {
        const opened = await openPane($)
        if (!opened.isPlaced) {
          $.ui.log(NARROW)

          return
        }
        if (args !== '') await askQuestions($)
      })().catch(error => $.ui.log(`Prompt Upgrade: ${messageOf(error)}`))

      return {
        text: args === '' ? 'Type the prompt you want to upgrade in the pane.' : 'Upgrading your prompt in the pane. Nothing runs until you press Run it.',
      }
    } catch (error) {
      return { text: `Prompt Upgrade could not do that: ${messageOf(error)}` }
    }
  }).catch(() => ({ text: 'Prompt Upgrade hit a problem and did nothing. Your prompt is safe.' }))

  on('prompt.submit', async ($, e, next) => {
    const isAuto = await read($, autoAtom)
    if (!isAuto) return next(e)
    const flow = await read($, flowAtom)
    const decision = route(e, isAuto, flow !== null)

    if (decision.kind === 'pass') return next(e)
    if (decision.kind === 'strip') return next({ ...e, text: decision.text })

    await begin($, e.text.trim(), 'reading')
    const opened = await openPane($)
    if (!opened.isPlaced) return { drop: NARROW }
    void askQuestions($).catch(error => $.ui.log(`Prompt Upgrade: ${messageOf(error)}`))

    return { drop: 'Prompt Upgrade opened this in the pane. Nothing runs until you press Run it.' }
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    // The person closed the pane from its mark: treat it as Cancel, so nothing is lost.
    if (e.id === PANE && e.origin.kind === 'person') {
      const view = await read($, viewAtom)
      const flow = await read($, flowAtom)
      if (view === 'history' && flow === null) {
        await update($, viewAtom, () => 'flow' as View)
      } else if (flow !== null) {
        draft = null
        await update($, flowAtom, () => null)
        await update($, viewAtom, () => 'flow' as View)
        if (flow.original.trim() !== '') await $.prompt.fill({ text: flow.original })
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const els: Els = {
      Box: table.Box,
      Text: table.Text,
      Button: table.Button,
      Input: 'Input' in table ? table.Input : undefined,
    }
    const flow = await read($, flowAtom)
    const view = await read($, viewAtom)
    const isAuto = await read($, autoAtom)
    const history = await read($, historyAtom)
    const cols = Math.max(24, Math.floor(e.props.bodyColumns))
    try {
      return drawPane({ els, cols, flow, view, isAuto, history, act: actions($, flow) })
    } catch (error) {
      const { Text } = els

      return <Text color="#E3B341">Prompt Upgrade could not draw this step: {messageOf(error)}</Text>
    }
  })
}
