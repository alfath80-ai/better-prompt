import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { parseQuestions, parseRewrite, route } from '../hooks/logic'

const PANE_ID = 'prompt-upgrade'
const LONG = 'write a launch email for our new budgeting app that people will actually read'
const UPGRADED =
  'Write a launch email for [product name], our new budgeting app, aimed at existing customers. Keep it under 200 words, friendly and plain, with one clear call to action. Done means a subject line and a body I can paste into [email tool].'

const QUESTIONS_REPLY = JSON.stringify({
  questions: [
    { question: 'Who is the email for?', options: ['New signups', 'Existing customers', 'Press'] },
    { question: 'How long should it be?', options: ['Short', 'Medium', 'Other'] },
  ],
})
const REWRITE_REPLY =
  'Here you go:\n```json\n' +
  JSON.stringify({ prompt: UPGRADED, added: ['Audience: existing customers', 'Length limit', 'Definition of done'] }) +
  '\n```'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function paneProps(bodyColumns: number) {
  return {
    title: 'Prompt Upgrade',
    isFocused: true,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  } as const
}

type World = {
  submitted: { text: string; origin: { kind: string } }[]
  fills: string[]
  closes: string[]
  models: { model: string; prompt: string }[]
  logs: string[]
  store: Record<string, unknown>
  clock: ReturnType<typeof mock.clock>
}

/** Stands in for the engine beneath the mod. */
function world(
  on: On,
  options: { auto?: boolean; isPlaced?: boolean; failModel?: boolean; noQuestions?: boolean } = {},
): World {
  const w: World = {
    submitted: [],
    fills: [],
    closes: [],
    models: [],
    logs: [],
    store: options.auto === undefined ? {} : { auto: options.auto },
    clock: mock.clock(on),
  }
  on("store.get", (_, e) => ({ value: w.store[e.key] }))
  on("store.set", (_, e) => {
    w.store[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () =>
    options.isPlaced === false
      ? { value: { isPlaced: false, reason: 'the terminal is 60 columns wide' } }
      : { value: { isPlaced: true } },
  )
  on('ui.close', (_, e) => {
    w.closes.push(e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', (_, e) => {
    w.logs.push(e.text)

    return { value: undefined }
  })
  on('prompt.fill', (_, e) => {
    w.fills.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    w.submitted.push({ text: e.text, origin: e.origin })

    return { text: e.text }
  })
  on('model.complete', (_, e) => {
    w.models.push({ model: e.model, prompt: e.prompt })
    if (options.failModel === true) {
      return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: USAGE } }
    }
    const text =
      e.model === 'haiku' ? (options.noQuestions === true ? '{"questions":[]}' : QUESTIONS_REPLY) : REWRITE_REPLY

    return { value: { isAnswered: true, text, usage: USAGE } }
  })

  return w
}

async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const better = (args: string) => ({
  command: 'better',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

describe('which prompts are intercepted', () => {
  test('the rules, one by one', async () => {
    const composer = { kind: 'composer' }
    expect(route({ text: LONG, origin: composer }, true, false)).toEqual({ kind: 'intercept' })
    expect(route({ text: LONG, origin: composer }, false, false)).toEqual({ kind: 'pass' })
    expect(route({ text: '/compact now please', origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: LONG, command: { name: 'x', args: '' }, origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: LONG, attachments: [{ type: 'image' }], origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: LONG, turnId: 't1', origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: 'yes', origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: 'keep going', origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: 'Sounds good!', origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: '> ' + LONG, origin: composer }, true, false)).toEqual({ kind: 'strip', text: LONG })
    expect(route({ text: LONG, origin: { kind: 'plugin' } }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: LONG, isMeta: true, origin: composer }, true, false)).toEqual({ kind: 'pass' })
    expect(route({ text: LONG, origin: composer }, true, true)).toEqual({ kind: 'pass' })
  })

  test('in a session: a long prompt goes to the pane, the rest straight through', async ($, on) => {
    const w = world(on, { auto: true })
    await start($)

    expect(await $.prompt.submit(typed('yes'))).toEqual({ text: 'yes' })
    expect(await $.prompt.submit(typed('> ' + LONG))).toEqual({ text: LONG })
    const taken = await $.prompt.submit(typed(LONG))
    expect(taken.drop).toContain('pane')
    await w.clock.settle()

    expect(w.submitted.map(one => one.text)).toEqual(['yes', LONG])
    expect(w.models[0]?.model).toBe('haiku')
  })
})

describe('reading the model', () => {
  test('reading the questions', async () => {
    const questions = parseQuestions(QUESTIONS_REPLY)
    expect(questions).toHaveLength(2)
    expect(questions[0]).toEqual({ question: 'Who is the email for?', options: ['New signups', 'Existing customers', 'Press'] })
    // "Other" is the mod's own chip, so a model's "Other" option is dropped, leaving two.
    expect(questions[1]?.options).toEqual(['Short', 'Medium'])

    const many = JSON.stringify({
      questions: [1, 2, 3, 4, 5].map(n => ({ question: `Q${n}?`, options: ['a', 'b', 'c', 'd', 'e'] })),
    })
    const capped = parseQuestions('Sure!\n' + many)
    expect(capped).toHaveLength(3)
    expect(capped[0]?.options).toHaveLength(4)

    expect(parseQuestions('{"questions":[{"question":"One option?","options":["only"]}]}')).toEqual([])
    expect(parseQuestions('no json here')).toEqual([])
    expect(parseQuestions('{"questions":[]}')).toEqual([])
  })

  test('reading the rewrite', async () => {
    expect(parseRewrite(REWRITE_REPLY)).toEqual({
      text: UPGRADED,
      added: ['Audience: existing customers', 'Length limit', 'Definition of done'],
    })
    expect(parseRewrite('Just do the thing well.')).toEqual({ text: 'Just do the thing well.', added: [] })
    expect(parseRewrite('   ')).toBeUndefined()
  })
})

test('the full flow from /better to Run', async ($, on) => {
  // Automatic mode on, to show the mod's own submission never loops back into the pane.
  const w = world(on, { auto: true })
  await start($)

  const answer = await $.command.run(better(LONG))
  expect(answer.text).toContain('Upgrading your prompt')
  await w.clock.settle()

  const ui = await $.ui.mount({
    plugin: 'prompt-upgrade',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: paneProps(100),
  })
  expect(await ui.find({ type: 'Text', text: /Who is the email for\?/ })).toBeDefined()
  expect(await ui.find({ key: 'other:0' })).toBeDefined()

  await ui.press({ key: 'opt:0:1' })
  expect(await ui.find({ type: 'Text', text: /1 of 2 answered/ })).toBeDefined()
  await ui.press({ key: 'skip:1' })
  await ui.press({ key: 'upgrade' })
  await w.clock.settle()

  expect(w.models.map(one => one.model)).toEqual(['haiku', 'sonnet'])
  expect(w.models[1]?.prompt).toContain('A: Existing customers')
  expect(w.models[1]?.prompt).not.toContain('How long should it be?')

  expect(await ui.find({ key: 'run' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Definition of done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[product name\]/ })).toBeDefined()

  await ui.press({ key: 'run' })
  await w.clock.settle()

  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]?.text).toBe(UPGRADED)
  expect(w.submitted[0]?.origin.kind).toBe('plugin')
  expect(w.closes).toContain(PANE_ID)
  // The history keeps the upgrade.
  const history = w.store.history as { upgraded: string }[]
  expect(history[0]?.upgraded).toBe(UPGRADED)
  await ui.unmount()
})

test('Cancel puts the original prompt back in the prompt box', async ($, on) => {
  const w = world(on, { auto: true })
  await start($)

  const taken = await $.prompt.submit(typed(LONG))
  expect(taken.drop).toBeDefined()
  await w.clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'prompt-upgrade', surface, component: 'Pane', requestId: PANE_ID, props: paneProps(80) })
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'cancel' })).toBeDefined()
      await ui.press({ key: 'cancel' })
    }
    await ui.unmount()
  }

  expect(w.fills).toEqual([LONG])
  expect(w.submitted).toEqual([])
  expect(w.closes).toContain(PANE_ID)
})

test('the on and off switch', async ($, on) => {
  const w = world(on)
  await start($)

  expect(await $.prompt.submit(typed(LONG))).toEqual({ text: LONG })

  expect((await $.command.run(better('on'))).text).toContain('automatic mode is on')
  expect(w.store.auto).toBe(true)
  expect((await $.prompt.submit(typed(LONG))).drop).toBeDefined()
  await w.clock.settle()

  expect((await $.command.run(better('off'))).text).toContain('automatic mode is off')
  expect(w.store.auto).toBe(false)
  expect(await $.prompt.submit(typed('another long prompt that should simply go through now'))).toEqual({
    text: 'another long prompt that should simply go through now',
  })
})

test('a narrow window puts the words back and says so', async ($, on) => {
  const w = world(on, { auto: true, isPlaced: false })
  await start($)

  const taken = await $.prompt.submit(typed(LONG))
  expect(taken.drop).toContain('too narrow')
  expect(w.fills).toEqual([LONG])
  expect(w.models).toEqual([])
})

test('a failed model call shows a calm error and can send the original', async ($, on) => {
  const w = world(on, { failModel: true })
  await start($)

  await $.command.run(better(LONG))
  await w.clock.settle()

  const ui = await $.ui.mount({ plugin: 'prompt-upgrade', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps(90) })
  expect(await ui.find({ type: 'Text', text: /Your prompt is safe/ })).toBeDefined()
  expect(await ui.find({ key: 'retry' })).toBeDefined()
  await ui.press({ key: 'send-original' })
  await w.clock.settle()

  expect(w.submitted.map(one => one.text)).toEqual([LONG])
  await ui.unmount()
})

test('the review fits a narrow pane and a wide one', async ($, on) => {
  const w = world(on, { noQuestions: true })
  await start($)

  await $.command.run(better(LONG))
  await w.clock.settle()

  for (const cols of [40, 140]) {
    const ui = await $.ui.mount({ plugin: 'prompt-upgrade', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneProps(cols) })
    expect(await ui.find({ key: 'run' }), `run at ${cols}`).toBeDefined()
    for (const text of await ui.findAll({ type: 'Text' })) {
      expect(text.text.length, `${cols}: ${text.text}`).toBeLessThanOrEqual(cols)
    }
    if (cols === 40) expect(await ui.find({ type: 'Text', text: /words before/ }), 'compact numbers').toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /^WORDS BEFORE$/ }), 'big number tiles').toBeDefined()
    await ui.unmount()
  }
})
