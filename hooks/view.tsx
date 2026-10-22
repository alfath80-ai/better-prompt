// Draws the pane from plain data. Reads only: every change goes through the
// handlers in `Actions`, which the hooks module supplies.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Flow, HistoryEntry, View } from '../types'
import { bigNumber, centre, clip, packRows, shortDate, wordCount, wrapText } from './logic'

export const GOLD = '#F2C46D'
export const SLATE = '#262B33'
export const MUTED = '#7D8590'
export const TEXT = '#E6EDF3'
export const GREEN = '#3DD68C'
export const AMBER = '#E3B341'
const INK = '#0D1117'

type Table = Elements['terminal']

export type Els = {
  Box: Table['Box']
  Text: Table['Text']
  Button: Table['Button']
  /** Absent where the surface has no text field (mobile). */
  Input: Table['Input'] | undefined
}

export type Actions = {
  answer: (index: number, value: string) => void
  other: (index: number) => void
  otherText: (index: number, value: string) => void
  skip: (index: number) => void
  upgrade: () => void
  run: () => void
  runText: (value: string) => void
  draft: (value: string) => void
  edit: () => void
  doneEditing: () => void
  copy: (surface: RenderSurface) => void
  cancel: () => void
  retry: () => void
  sendOriginal: () => void
  compose: (value: string) => void
  openHistory: (id: string) => void
  back: () => void
}

export type PaneData = {
  els: Els
  cols: number
  flow: Flow | null
  view: View
  isAuto: boolean
  history: readonly HistoryEntry[]
  act: Actions
}

type Chip = {
  key: string
  label: string
  tone: 'gold' | 'slate' | 'quiet' | 'picked'
  press: (surface: RenderSurface) => void
}

// ---------------------------------------------------------------- pieces

function header(d: PaneData): RenderElement {
  const { Box, Text } = d.els
  const title = 'PROMPT UPGRADE'
  const status = d.isAuto ? 'AUTO ON' : 'AUTO OFF'
  const gap = d.cols - title.length - status.length
  const rule = Math.min(title.length, d.cols)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={TEXT} bold wrap="truncate">{clip(title, d.cols)}</Text>
        {gap >= 2 && <Text>{' '.repeat(gap)}</Text>}
        {gap >= 2 && <Text color={d.isAuto ? GREEN : MUTED}>{status}</Text>}
      </Box>
      <Box flexDirection="row">
        <Text color={GOLD}>{'━'.repeat(rule)}</Text>
        {d.cols > rule && <Text color={SLATE}>{'─'.repeat(d.cols - rule)}</Text>}
      </Box>
    </Box>
  )
}

function section(d: PaneData, label: string): RenderElement {
  const { Box, Text } = d.els
  const name = clip(label.toUpperCase(), d.cols)
  const rest = d.cols - name.length - 1

  return (
    <Box flexDirection="row" marginTop={1}>
      <Text color={MUTED}>{name}</Text>
      {rest > 0 && <Text color={SLATE}>{' ' + '─'.repeat(rest)}</Text>}
    </Box>
  )
}

const STEPS = ['Your prompt', 'Questions', 'Rewrite', 'Review'] as const

function stepIndex(flow: Flow): number {
  switch (flow.step) {
    case 'compose':
    case 'reading':
      return 0
    case 'questions':
      return 1
    case 'rewriting':
      return 2
    case 'review':
      return 3
    case 'error':
      return flow.error?.stage === 'rewriting' ? 2 : 0
  }
}

function tracker(d: PaneData, current: number): RenderElement {
  const { Box, Text } = d.els
  const mark = (index: number) => (index < current ? '✓' : String(index + 1))
  const full = STEPS.map((name, index) => `${mark(index)} ${name}`)
  const joiner = ' ── '
  const fits = full.join(joiner).length <= d.cols
  // Narrow: only the current step keeps its name.
  const parts = fits
    ? full
    : STEPS.map((name, index) => (index === current ? `${mark(index)} ${name}` : mark(index)))
  const sep = fits ? joiner : ' ─ '
  const total = parts.join(sep).length

  return (
    <Box flexDirection="row" marginTop={1}>
      {parts.map((part, index) => (
        <Box flexDirection="row" key={`step-${index}`}>
          {index > 0 && <Text color={SLATE}>{sep}</Text>}
          <Text
            color={index < current ? GREEN : index === current ? GOLD : MUTED}
            bold={index === current}
          >
            {total > d.cols ? clip(part, Math.max(1, Math.floor(d.cols / 4) - 3)) : part}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function chipRow(d: PaneData, chips: readonly Chip[], keyBase: string): RenderElement {
  const { Box, Button, Text } = d.els
  const fitted = chips.map(chip => ({ ...chip, label: clip(chip.label, Math.max(1, d.cols - 2)) }))
  const rows = packRows(fitted, d.cols)

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIndex) => (
        <Box flexDirection="row" key={`${keyBase}-row-${rowIndex}`} marginTop={rowIndex === 0 ? 0 : 1}>
          {row.map((chip, index) => (
            <Box flexDirection="row" key={`${keyBase}-cell-${chip.key}`}>
              {index > 0 && <Text> </Text>}
              <Button key={chip.key} label={chip.label} plain onPress={press => chip.press(press.surface)}>
                {chip.tone === 'quiet' ? (
                  <Text color={MUTED}>{` ${chip.label} `}</Text>
                ) : (
                  <Text
                    backgroundColor={chip.tone === 'gold' ? GOLD : chip.tone === 'picked' ? GREEN : SLATE}
                    color={chip.tone === 'slate' ? TEXT : INK}
                    bold={chip.tone !== 'slate'}
                  >
                    {` ${chip.label} `}
                  </Text>
                )}
              </Button>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function lines(d: PaneData, text: string, width: number, color: string, keyBase: string): RenderElement[] {
  const { Text } = d.els

  return wrapText(text, width).map((line, index) => (
    <Text color={color} wrap="truncate">
      {line === '' ? ' ' : line}
    </Text>
  ))
}

function card(
  d: PaneData,
  options: { title: string; body: string; width: number; border: string; titleColor: string; key: string },
): RenderElement {
  const { Box, Text } = d.els
  const inner = Math.max(1, options.width - 4)

  return (
    <Box
      key={options.key}
      flexDirection="column"
      borderStyle="round"
      borderColor={options.border}
      paddingX={1}
      width={options.width}
    >
      <Text color={options.titleColor} wrap="truncate">{clip(options.title.toUpperCase(), inner)}</Text>
      {lines(d, options.body, inner, TEXT, `${options.key}-line`)}
    </Box>
  )
}

function promptCard(d: PaneData, flow: Flow, note: string, noteColor = MUTED): RenderElement {
  const { Box, Text } = d.els

  return (
    <Box flexDirection="column" marginTop={1}>
      {card(d, { title: 'Your prompt', body: flow.original, width: d.cols, border: SLATE, titleColor: MUTED, key: 'original' })}
      <Box marginTop={1}>
        <Text color={noteColor} wrap="truncate">{clip(note, d.cols)}</Text>
      </Box>
    </Box>
  )
}

function tiles(d: PaneData, flow: Flow): RenderElement {
  const { Box, Text } = d.els
  const before = wordCount(flow.original)
  const after = wordCount(flow.rewrite?.text ?? '')
  const added = flow.rewrite?.added.length ?? 0
  const items = [
    { key: 'before', value: before, caption: 'WORDS BEFORE', color: TEXT },
    { key: 'after', value: after, caption: 'WORDS AFTER', color: GOLD },
    { key: 'added', value: added, caption: 'DETAILS ADDED', color: GREEN },
  ]
  const sized = items.map(item => {
    const rows = bigNumber(item.value)
    const inner = Math.max(rows[0].length, item.caption.length)

    return { ...item, rows, inner, outer: inner + 4 }
  })
  const total = sized.reduce((sum, item) => sum + item.outer, 0) + (sized.length - 1)

  if (total > d.cols) {
    const line = `${before} words before · ${after} after · ${added} details added`

    return (
      <Box marginTop={1}>
        <Text color={TEXT} wrap="truncate">{clip(line, d.cols)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" marginTop={1}>
      {sized.map((item, index) => (
        <Box flexDirection="row" key={`tile-${item.key}`}>
          {index > 0 && <Text> </Text>}
          <Box flexDirection="column" borderStyle="round" borderColor={SLATE} paddingX={1} width={item.outer}>
            {item.rows.map((row, rowIndex) => (
              <Text color={item.color}>{centre(row, item.inner)}</Text>
            ))}
            <Text color={MUTED}>{centre(item.caption, item.inner)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- screens

function composeScreen(d: PaneData): RenderElement {
  const { Box, Text, Input } = d.els

  return (
    <Box flexDirection="column">
      {section(d, 'Your prompt')}
      {Input === undefined ? (
        <Text color={TEXT} wrap="truncate">{clip('Type /better followed by your prompt.', d.cols)}</Text>
      ) : (
        <Input
          key="compose"
          placeholder="Type the prompt you want to upgrade"
          submitLabel="upgrade"
          rows={3}
          autoFocus
          onSubmit={value => d.act.compose(value)}
        />
      )}
      <Box marginTop={1}>{chipRow(d, [{ key: 'cancel', label: 'Cancel', tone: 'quiet', press: () => d.act.cancel() }], 'compose')}</Box>
    </Box>
  )
}

function questionsScreen(d: PaneData, flow: Flow): RenderElement {
  const { Box, Text, Input } = d.els
  const done = flow.answers.filter(answer => answer !== null).length
  const answered = flow.answers.filter(answer => answer !== null && answer.kind !== 'skip').length
  const isAllDone = done === flow.questions.length
  const textWidth = Math.max(1, d.cols - 4)

  return (
    <Box flexDirection="column">
      {section(d, 'A few quick questions')}
      {flow.questions.map((question, index) => {
        const answer = flow.answers[index] ?? null
        const isDone = answer !== null
        const wrapped = wrapText(question.question, textWidth)
        const chips: Chip[] = question.options.map((option, optionIndex) => ({
          key: `opt:${index}:${optionIndex}`,
          label: option,
          tone: answer !== null && answer.kind === 'option' && answer.value === option ? 'picked' : 'slate',
          press: () => d.act.answer(index, option),
        }))
        chips.push({
          key: `other:${index}`,
          label: answer?.kind === 'other' ? `Other: ${answer.value}` : 'Other (type it)',
          tone: answer?.kind === 'other' ? 'picked' : 'slate',
          press: () => d.act.other(index),
        })
        chips.push({
          key: `skip:${index}`,
          label: answer?.kind === 'skip' ? 'Skipped' : 'Skip',
          tone: 'quiet',
          press: () => d.act.skip(index),
        })

        return (
          <Box flexDirection="column" marginTop={1} key={`q-${index}`}>
            {wrapped.map((line, lineIndex) => (
              <Box flexDirection="row" key={`q-${index}-line-${lineIndex}`}>
                {lineIndex === 0 ? (
                  <Text backgroundColor={isDone ? GREEN : GOLD} color={INK} bold>
                    {isDone ? ' ✓ ' : ` ${index + 1} `}
                  </Text>
                ) : (
                  <Text>{'   '}</Text>
                )}
                <Text color={TEXT} wrap="truncate">{' ' + line}</Text>
              </Box>
            ))}
            <Box marginTop={1} marginLeft={4} flexDirection="column">
              {chipRow({ ...d, cols: textWidth }, chips, `q${index}`)}
              {flow.otherOpen === index && Input !== undefined && (
                <Box marginTop={1}>
                  <Input
                    key={`other-text:${index}`}
                    placeholder="Type your answer"
                    submitLabel="save"
                    autoFocus
                    onSubmit={value => d.act.otherText(index, value)}
                  />
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={MUTED} wrap="truncate">
          {clip(`${answered} of ${flow.questions.length} answered`, d.cols)}
        </Text>
      </Box>
      <Box marginTop={1}>
        {chipRow(
          d,
          [
            {
              key: 'upgrade',
              label: isAllDone ? 'Upgrade now' : 'Skip the rest, upgrade now',
              tone: 'gold',
              press: () => d.act.upgrade(),
            },
            { key: 'cancel', label: 'Cancel', tone: 'quiet', press: () => d.act.cancel() },
          ],
          'qa',
        )}
      </Box>
    </Box>
  )
}

function reviewScreen(d: PaneData, flow: Flow): RenderElement {
  const { Box, Text, Input } = d.els
  const rewrite = flow.rewrite ?? { text: '', added: [] }
  const isEditing = flow.editing && Input !== undefined
  const buttons: Chip[] = isEditing
    ? [
        { key: 'run', label: 'Run it', tone: 'gold', press: () => d.act.run() },
        { key: 'edit-done', label: 'Done editing', tone: 'slate', press: () => d.act.doneEditing() },
        { key: 'cancel', label: 'Cancel', tone: 'quiet', press: () => d.act.cancel() },
      ]
    : [
        { key: 'run', label: 'Run it', tone: 'gold', press: () => d.act.run() },
        ...(Input !== undefined
          ? [{ key: 'edit', label: 'Edit', tone: 'slate' as const, press: () => d.act.edit() }]
          : []),
        { key: 'copy', label: flow.copied ? 'Copied' : 'Copy', tone: flow.copied ? 'picked' : 'slate', press: surface => d.act.copy(surface) },
        { key: 'cancel', label: 'Cancel', tone: 'quiet', press: () => d.act.cancel() },
      ]
  const isSideBySide = d.cols >= 60
  const half = Math.floor((d.cols - 1) / 2)

  return (
    <Box flexDirection="column">
      {tiles(d, flow)}
      <Box marginTop={1}>{chipRow(d, buttons, 'review')}</Box>
      {flow.note !== null && (
        <Text color={AMBER} wrap="truncate">{clip(flow.note, d.cols)}</Text>
      )}
      {isEditing && Input !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={MUTED} wrap="truncate">{clip('Edit the upgrade. Enter runs it.', d.cols)}</Text>
          <Input
            key="edit-text"
            value={rewrite.text}
            submitLabel="run"
            rows={Math.min(10, Math.max(3, wrapText(rewrite.text, d.cols - 4).length))}
            autoFocus
            onInput={value => d.act.draft(value)}
            onSubmit={value => d.act.runText(value)}
          />
        </Box>
      )}
      {rewrite.added.length > 0 && section(d, 'What I added')}
      {rewrite.added.map((item, index) => (
        <Box flexDirection="row" key={`added-${index}`}>
          <Text color={GREEN}>+ </Text>
          <Text color={TEXT} wrap="truncate">{clip(item, d.cols - 2)}</Text>
        </Box>
      ))}
      {section(d, 'Side by side')}
      <Box flexDirection={isSideBySide ? 'row' : 'column'}>
        {card(d, {
          title: 'Your prompt',
          body: flow.original,
          width: isSideBySide ? half : d.cols,
          border: SLATE,
          titleColor: MUTED,
          key: 'left',
        })}
        {isSideBySide && <Text> </Text>}
        {card(d, {
          title: 'Upgrade',
          body: rewrite.text,
          width: isSideBySide ? d.cols - half - 1 : d.cols,
          border: GOLD,
          titleColor: GOLD,
          key: 'right',
        })}
      </Box>
    </Box>
  )
}

function errorScreen(d: PaneData, flow: Flow): RenderElement {
  const { Box, Text } = d.els
  const inner = Math.max(1, d.cols - 4)
  const message = flow.error?.message ?? 'The model did not answer.'

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={AMBER} paddingX={1} width={d.cols}>
        <Text color={AMBER} wrap="truncate">{clip('THE MODEL DID NOT ANSWER', inner)}</Text>
        {lines(d, message, inner, TEXT, 'error')}
        <Text color={GREEN} wrap="truncate">{clip('Your prompt is safe. Nothing was sent.', inner)}</Text>
      </Box>
      <Box marginTop={1}>
        {chipRow(
          d,
          [
            { key: 'retry', label: 'Try again', tone: 'gold', press: () => d.act.retry() },
            { key: 'send-original', label: 'Send my original', tone: 'slate', press: () => d.act.sendOriginal() },
            { key: 'cancel', label: 'Cancel', tone: 'quiet', press: () => d.act.cancel() },
          ],
          'error',
        )}
      </Box>
    </Box>
  )
}

function historyScreen(d: PaneData): RenderElement {
  const { Box, Button, Text } = d.els

  return (
    <Box flexDirection="column">
      {section(d, `Last ${d.history.length} upgrades`)}
      {d.history.length === 0 && (
        <Text color={MUTED} wrap="truncate">{clip('No upgrades yet. Try /better followed by a prompt.', d.cols)}</Text>
      )}
      {[...d.history].reverse().map(entry => {
        const when = shortDate(entry.at)
        const room = Math.max(1, d.cols - when.length - 2)

        return (
          <Button key={`hist:${entry.id}`} plain onPress={() => d.act.openHistory(entry.id)}>
            <Text color={MUTED}>{when}</Text>
            {'  '}
            <Text color={TEXT}>{clip(entry.original.replace(/\s+/g, ' '), room)}</Text>
          </Button>
        )
      })}
      <Box marginTop={1}>
        {chipRow(d, [{ key: 'back', label: 'Close', tone: 'slate', press: () => d.act.back() }], 'history')}
      </Box>
    </Box>
  )
}

export function drawPane(d: PaneData): RenderElement {
  const { Box, Text } = d.els
  const flow = d.flow

  if (d.view === 'history' || flow === null) {
    return (
      <Box flexDirection="column">
        {header(d)}
        {historyScreen(d)}
      </Box>
    )
  }

  let body: RenderElement
  switch (flow.step) {
    case 'compose':
      body = composeScreen(d)
      break
    case 'reading':
      body = promptCard(d, flow, 'Reading your prompt and picking the questions that matter.')
      break
    case 'questions':
      body = questionsScreen(d, flow)
      break
    case 'rewriting':
      body = promptCard(d, flow, 'Writing the upgrade from your answers.', GOLD)
      break
    case 'review':
      body = reviewScreen(d, flow)
      break
    case 'error':
      body = errorScreen(d, flow)
      break
  }

  return (
    <Box flexDirection="column">
      {header(d)}
      {tracker(d, stepIndex(flow))}
      {body}
      <Text> </Text>
    </Box>
  )
}
