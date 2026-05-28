// Генератор тем VS Code. Каждая палитра состоит из двух частей:
//  - UI-цвета (фон, бордеры, акценты UI) — близки к webview-палитре Cockpit
//  - SYNTAX (s.*) — приглушённые цвета для подсветки кода и редакторских акцентов.
//    Отдельно потому, что декоративные неоновые акценты, когда красят весь
//    редактор, превращаются в кислоту. Здесь chroma ниже и оттенки подобраны
//    под читаемость кода в каждой теме.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, formatHex, formatHex8 } from 'culori'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PALETTES = {
  arcade: {
    type: 'dark',
    label: 'Cockpit Arcade',
    bg: '0.13 0.025 275',
    fg: '0.93 0.01 80',
    card: '0.16 0.035 275',
    muted: '0.2 0.04 275',
    mutedFg: '0.62 0.03 280',
    border: '0.26 0.04 275',
    borderStrong: '0.42 0.1 290',
    accent: '0.22 0.05 275',
    statusBg: '0.18 0.04 275',
    magenta: '0.7 0.2 350',
    pink: '0.8 0.15 355',
    indigo: '0.65 0.18 290',
    cyan: '0.78 0.12 200',
    lime: '0.82 0.14 130',
    gold: '0.82 0.14 80',
    coral: '0.74 0.16 40',
    s: {
      comment: '0.5 0.02 275',
      string: '0.78 0.12 140',
      number: '0.78 0.13 70',
      keyword: '0.72 0.16 295',
      fn: '0.78 0.13 210',
      type: '0.78 0.12 250',
      varColor: '0.9 0.02 80',
      prop: '0.78 0.13 0',
      op: '0.75 0.13 25',
      attr: '0.8 0.13 85',
      tag: '0.72 0.14 280',
      markup: '0.78 0.15 320',
      invalid: '0.7 0.2 25',
    },
  },
  light: {
    type: 'light',
    label: 'Cockpit Light',
    bg: '0.985 0.005 80',
    fg: '0.22 0.02 270',
    card: '1 0 0',
    muted: '0.95 0.01 80',
    mutedFg: '0.45 0.02 270',
    border: '0.85 0.02 270',
    borderStrong: '0.6 0.05 270',
    accent: '0.94 0.015 80',
    statusBg: '0.94 0.02 270',
    magenta: '0.5 0.2 350',
    pink: '0.62 0.18 355',
    indigo: '0.45 0.2 290',
    cyan: '0.55 0.13 210',
    lime: '0.62 0.16 145',
    gold: '0.65 0.14 75',
    coral: '0.58 0.18 40',
    s: {
      comment: '0.55 0.04 270',
      string: '0.45 0.14 145',
      number: '0.5 0.13 50',
      keyword: '0.42 0.18 290',
      fn: '0.45 0.16 220',
      type: '0.42 0.16 250',
      varColor: '0.22 0.02 270',
      prop: '0.48 0.14 350',
      op: '0.5 0.14 25',
      attr: '0.5 0.14 80',
      tag: '0.45 0.18 290',
      markup: '0.45 0.18 320',
      invalid: '0.55 0.22 25',
    },
  },
  synthwave: {
    type: 'dark',
    label: 'Cockpit Synthwave',
    bg: '0.15 0.06 300',
    fg: '0.92 0.03 320',
    card: '0.19 0.07 300',
    muted: '0.24 0.06 300',
    mutedFg: '0.66 0.05 320',
    border: '0.34 0.08 310',
    borderStrong: '0.5 0.14 325',
    accent: '0.26 0.07 305',
    statusBg: '0.2 0.07 305',
    magenta: '0.72 0.22 345',
    pink: '0.8 0.18 5',
    indigo: '0.62 0.2 295',
    cyan: '0.82 0.15 200',
    lime: '0.82 0.14 160',
    gold: '0.82 0.14 80',
    coral: '0.76 0.16 35',
    s: {
      comment: '0.55 0.05 290',
      string: '0.82 0.13 320',
      number: '0.84 0.13 60',
      keyword: '0.76 0.16 330',
      fn: '0.82 0.15 200',
      type: '0.78 0.14 290',
      varColor: '0.9 0.04 320',
      prop: '0.82 0.13 5',
      op: '0.78 0.14 30',
      attr: '0.84 0.13 85',
      tag: '0.78 0.15 280',
      markup: '0.82 0.16 345',
      invalid: '0.72 0.22 25',
    },
  },
  matrix: {
    type: 'dark',
    label: 'Cockpit Matrix',
    bg: '0.13 0.02 150',
    fg: '0.86 0.13 140',
    card: '0.16 0.03 150',
    muted: '0.2 0.03 150',
    mutedFg: '0.58 0.08 145',
    border: '0.28 0.06 150',
    borderStrong: '0.45 0.12 145',
    accent: '0.22 0.04 150',
    statusBg: '0.18 0.04 150',
    magenta: '0.7 0.16 95',
    pink: '0.78 0.14 110',
    indigo: '0.66 0.12 170',
    cyan: '0.78 0.12 190',
    lime: '0.85 0.16 130',
    gold: '0.82 0.13 105',
    coral: '0.72 0.16 50',
    s: {
      // Намеренно не всё зелёное — иначе код не читается.
      // Зелёный остаётся доминантой, но строки/числа/типы — в дополняющих оттенках.
      comment: '0.48 0.04 150',
      string: '0.84 0.1 105',
      number: '0.78 0.1 195',
      keyword: '0.82 0.14 140',
      fn: '0.78 0.1 175',
      type: '0.8 0.09 115',
      varColor: '0.86 0.08 140',
      prop: '0.78 0.11 165',
      op: '0.78 0.13 95',
      attr: '0.82 0.11 80',
      tag: '0.76 0.12 180',
      markup: '0.84 0.15 130',
      invalid: '0.72 0.2 25',
    },
  },
  amber: {
    type: 'dark',
    label: 'Cockpit Amber',
    bg: '0.14 0.025 60',
    fg: '0.84 0.12 75',
    card: '0.17 0.03 55',
    muted: '0.21 0.03 55',
    mutedFg: '0.6 0.08 70',
    border: '0.3 0.06 60',
    borderStrong: '0.5 0.1 70',
    accent: '0.23 0.04 55',
    statusBg: '0.19 0.04 60',
    magenta: '0.76 0.14 45',
    pink: '0.82 0.12 60',
    indigo: '0.65 0.12 70',
    cyan: '0.78 0.1 90',
    lime: '0.82 0.13 95',
    gold: '0.84 0.14 80',
    coral: '0.74 0.16 35',
    s: {
      // Янтарный фон + контрастный голубой/сепия для читаемости.
      comment: '0.5 0.05 60',
      string: '0.82 0.11 90',
      number: '0.82 0.1 50',
      keyword: '0.8 0.14 60',
      fn: '0.78 0.1 200',
      type: '0.78 0.11 40',
      varColor: '0.86 0.11 75',
      prop: '0.78 0.12 30',
      op: '0.78 0.13 20',
      attr: '0.82 0.12 85',
      tag: '0.76 0.12 50',
      markup: '0.84 0.14 65',
      invalid: '0.72 0.22 25',
    },
  },
  midnight: {
    type: 'dark',
    label: 'Cockpit Midnight',
    bg: '0.17 0.025 250',
    fg: '0.9 0.02 240',
    card: '0.21 0.035 250',
    muted: '0.25 0.04 250',
    mutedFg: '0.65 0.04 240',
    border: '0.32 0.05 250',
    borderStrong: '0.5 0.08 240',
    accent: '0.27 0.04 250',
    statusBg: '0.23 0.04 250',
    magenta: '0.7 0.14 320',
    pink: '0.78 0.12 340',
    indigo: '0.66 0.13 250',
    cyan: '0.78 0.11 210',
    lime: '0.8 0.12 160',
    gold: '0.8 0.12 85',
    coral: '0.74 0.14 35',
    s: {
      comment: '0.5 0.03 250',
      string: '0.8 0.11 165',
      number: '0.78 0.11 70',
      keyword: '0.76 0.13 270',
      fn: '0.8 0.12 215',
      type: '0.78 0.12 240',
      varColor: '0.9 0.02 240',
      prop: '0.8 0.12 340',
      op: '0.78 0.12 30',
      attr: '0.8 0.11 80',
      tag: '0.76 0.13 260',
      markup: '0.8 0.13 320',
      invalid: '0.72 0.2 25',
    },
  },
}

function hex(lch, alpha) {
  const c = parse(`oklch(${lch}${alpha != null ? ` / ${alpha}` : ''})`)
  if (!c) throw new Error(`bad color: ${lch}`)
  return alpha != null ? formatHex8(c) : formatHex(c)
}

function buildTheme(p) {
  const bg = hex(p.bg)
  const fg = hex(p.fg)
  const card = hex(p.card)
  const muted = hex(p.muted)
  const mutedFg = hex(p.mutedFg)
  const border = hex(p.border)
  const borderStrong = hex(p.borderStrong)
  const accent = hex(p.accent)
  const statusBg = hex(p.statusBg)
  const magenta = hex(p.magenta)
  const pink = hex(p.pink)
  const indigo = hex(p.indigo)
  const cyan = hex(p.cyan)
  const lime = hex(p.lime)
  const gold = hex(p.gold)
  const coral = hex(p.coral)

  // syntax (приглушённый)
  const s = {
    comment: hex(p.s.comment),
    string: hex(p.s.string),
    number: hex(p.s.number),
    keyword: hex(p.s.keyword),
    fn: hex(p.s.fn),
    type: hex(p.s.type),
    var: hex(p.s.varColor),
    prop: hex(p.s.prop),
    op: hex(p.s.op),
    attr: hex(p.s.attr),
    tag: hex(p.s.tag),
    markup: hex(p.s.markup),
    invalid: hex(p.s.invalid),
  }

  const isLight = p.type === 'light'
  const lineHighlight = hex(p.border, isLight ? 0.35 : 0.25)

  const colors = {
    foreground: fg,
    focusBorder: hex(p.magenta, 0.6),
    descriptionForeground: mutedFg,
    errorForeground: coral,
    'selection.background': hex(p.magenta, 0.22),

    // EDITOR
    'editor.background': bg,
    'editor.foreground': fg,
    'editorLineNumber.foreground': hex(p.mutedFg, 0.5),
    'editorLineNumber.activeForeground': fg,
    'editor.lineHighlightBackground': lineHighlight,
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': hex(p.magenta, 0.22),
    'editor.selectionHighlightBackground': hex(p.magenta, 0.1),
    'editor.findMatchBackground': hex(p.gold, 0.32),
    'editor.findMatchHighlightBackground': hex(p.gold, 0.15),
    'editor.wordHighlightBackground': hex(p.s.fn, 0.14),
    'editor.wordHighlightStrongBackground': hex(p.s.fn, 0.22),
    'editorCursor.foreground': s.keyword,
    'editorWhitespace.foreground': hex(p.border, 0.5),
    'editorIndentGuide.background1': hex(p.border, 0.6),
    'editorIndentGuide.activeBackground1': hex(p.borderStrong, 0.7),
    'editorBracketMatch.background': hex(p.s.keyword, 0.14),
    'editorBracketMatch.border': hex(p.s.keyword, 0.4),
    'editorBracketHighlight.foreground1': s.keyword,
    'editorBracketHighlight.foreground2': s.fn,
    'editorBracketHighlight.foreground3': s.string,
    'editorBracketHighlight.foreground4': s.number,
    'editorBracketHighlight.foreground5': s.type,
    'editorBracketHighlight.foreground6': s.prop,
    'editorBracketHighlight.unexpectedBracket.foreground': coral,
    'editorGutter.background': bg,
    'editorGutter.modifiedBackground': gold,
    'editorGutter.addedBackground': lime,
    'editorGutter.deletedBackground': coral,
    'editorWidget.background': card,
    'editorWidget.border': border,
    'editorSuggestWidget.background': card,
    'editorSuggestWidget.border': border,
    'editorSuggestWidget.selectedBackground': accent,
    'editorSuggestWidget.highlightForeground': s.keyword,
    'editorHoverWidget.background': card,
    'editorHoverWidget.border': border,
    'editorError.foreground': coral,
    'editorWarning.foreground': gold,
    'editorInfo.foreground': cyan,
    'editorOverviewRuler.border': border,
    'editorOverviewRuler.errorForeground': hex(p.coral, 0.7),
    'editorOverviewRuler.warningForeground': hex(p.gold, 0.7),
    'editorOverviewRuler.infoForeground': hex(p.cyan, 0.7),

    // CHROME
    'titleBar.activeBackground': bg,
    'titleBar.activeForeground': fg,
    'titleBar.inactiveBackground': bg,
    'titleBar.inactiveForeground': mutedFg,
    'titleBar.border': border,

    'activityBar.background': statusBg,
    'activityBar.foreground': fg,
    'activityBar.inactiveForeground': mutedFg,
    'activityBar.border': border,
    'activityBarBadge.background': magenta,
    'activityBarBadge.foreground': bg,
    'activityBar.activeBorder': magenta,

    'sideBar.background': statusBg,
    'sideBar.foreground': fg,
    'sideBar.border': border,
    'sideBarTitle.foreground': fg,
    'sideBarSectionHeader.background': accent,
    'sideBarSectionHeader.foreground': fg,
    'sideBarSectionHeader.border': border,

    // Спокойный статусбар — НЕ ярко-розовый.
    'statusBar.background': statusBg,
    'statusBar.foreground': fg,
    'statusBar.border': border,
    'statusBar.noFolderBackground': statusBg,
    'statusBar.debuggingBackground': gold,
    'statusBar.debuggingForeground': bg,
    'statusBarItem.hoverBackground': accent,
    'statusBarItem.remoteBackground': indigo,
    'statusBarItem.remoteForeground': bg,
    'statusBarItem.prominentBackground': accent,
    'statusBarItem.prominentForeground': fg,

    'panel.background': bg,
    'panel.border': border,
    'panelTitle.activeForeground': fg,
    'panelTitle.inactiveForeground': mutedFg,
    'panelTitle.activeBorder': magenta,

    'tab.activeBackground': bg,
    'tab.inactiveBackground': statusBg,
    'tab.activeForeground': fg,
    'tab.inactiveForeground': mutedFg,
    'tab.border': border,
    'tab.activeBorderTop': magenta,
    'tab.hoverBackground': accent,
    'tab.unfocusedHoverBackground': accent,
    'editorGroupHeader.tabsBackground': statusBg,
    'editorGroupHeader.tabsBorder': border,
    'editorGroupHeader.noTabsBackground': statusBg,

    'terminal.background': bg,
    'terminal.foreground': fg,
    'terminalCursor.foreground': s.keyword,
    'terminal.selectionBackground': hex(p.magenta, 0.25),
    'terminal.border': border,
    'terminal.ansiBlack': bg,
    'terminal.ansiRed': coral,
    'terminal.ansiGreen': lime,
    'terminal.ansiYellow': gold,
    'terminal.ansiBlue': indigo,
    'terminal.ansiMagenta': magenta,
    'terminal.ansiCyan': cyan,
    'terminal.ansiWhite': fg,
    'terminal.ansiBrightBlack': mutedFg,
    'terminal.ansiBrightRed': coral,
    'terminal.ansiBrightGreen': lime,
    'terminal.ansiBrightYellow': gold,
    'terminal.ansiBrightBlue': indigo,
    'terminal.ansiBrightMagenta': pink,
    'terminal.ansiBrightCyan': cyan,
    'terminal.ansiBrightWhite': fg,

    'input.background': card,
    'input.foreground': fg,
    'input.border': border,
    'input.placeholderForeground': mutedFg,
    'inputOption.activeBorder': magenta,
    'inputOption.activeBackground': hex(p.magenta, 0.2),
    'inputValidation.errorBackground': hex(p.coral, 0.22),
    'inputValidation.errorBorder': coral,
    'inputValidation.warningBackground': hex(p.gold, 0.22),
    'inputValidation.warningBorder': gold,
    'inputValidation.infoBackground': hex(p.cyan, 0.22),
    'inputValidation.infoBorder': cyan,

    'button.background': magenta,
    'button.foreground': isLight ? '#ffffff' : bg,
    'button.hoverBackground': pink,
    'button.secondaryBackground': accent,
    'button.secondaryForeground': fg,
    'button.secondaryHoverBackground': muted,

    'dropdown.background': card,
    'dropdown.foreground': fg,
    'dropdown.border': border,
    'dropdown.listBackground': card,

    'list.activeSelectionBackground': accent,
    'list.activeSelectionForeground': fg,
    'list.inactiveSelectionBackground': muted,
    'list.inactiveSelectionForeground': fg,
    'list.hoverBackground': accent,
    'list.focusBackground': accent,
    'list.focusOutline': magenta,
    'list.highlightForeground': s.keyword,
    'list.errorForeground': coral,
    'list.warningForeground': gold,

    'badge.background': gold,
    'badge.foreground': bg,
    'progressBar.background': magenta,

    'scrollbarSlider.background': hex(p.borderStrong, 0.28),
    'scrollbarSlider.hoverBackground': hex(p.borderStrong, 0.45),
    'scrollbarSlider.activeBackground': hex(p.borderStrong, 0.65),

    'peekView.border': hex(p.magenta, 0.6),
    'peekViewEditor.background': bg,
    'peekViewEditor.matchHighlightBackground': hex(p.gold, 0.22),
    'peekViewResult.background': card,
    'peekViewResult.selectionBackground': accent,
    'peekViewTitle.background': card,
    'peekViewTitleLabel.foreground': fg,
    'peekViewTitleDescription.foreground': mutedFg,

    'diffEditor.insertedTextBackground': hex(p.lime, 0.12),
    'diffEditor.removedTextBackground': hex(p.coral, 0.14),
    'diffEditor.insertedLineBackground': hex(p.lime, 0.06),
    'diffEditor.removedLineBackground': hex(p.coral, 0.08),
    'diffEditor.border': border,

    'gitDecoration.modifiedResourceForeground': gold,
    'gitDecoration.addedResourceForeground': lime,
    'gitDecoration.deletedResourceForeground': coral,
    'gitDecoration.untrackedResourceForeground': cyan,
    'gitDecoration.ignoredResourceForeground': hex(p.mutedFg, 0.5),
    'gitDecoration.conflictingResourceForeground': pink,

    'notifications.background': card,
    'notifications.foreground': fg,
    'notifications.border': border,
    'notificationCenterHeader.background': card,
    'notificationLink.foreground': s.keyword,
    'notificationsErrorIcon.foreground': coral,
    'notificationsWarningIcon.foreground': gold,
    'notificationsInfoIcon.foreground': cyan,

    'breadcrumb.foreground': mutedFg,
    'breadcrumb.focusForeground': fg,
    'breadcrumb.activeSelectionForeground': s.keyword,
    'breadcrumb.background': bg,
    'breadcrumbPicker.background': card,

    'menu.background': card,
    'menu.foreground': fg,
    'menu.selectionBackground': accent,
    'menu.selectionForeground': fg,
    'menu.separatorBackground': border,
    'menu.border': border,
    'menubar.selectionBackground': accent,
    'menubar.selectionForeground': fg,

    'minimap.findMatchHighlight': hex(p.gold, 0.6),
    'minimap.selectionHighlight': hex(p.magenta, 0.4),
    'minimap.errorHighlight': hex(p.coral, 0.6),
    'minimap.warningHighlight': hex(p.gold, 0.6),
    'minimap.background': bg,

    'pickerGroup.border': border,
    'pickerGroup.foreground': s.keyword,
    'quickInput.background': card,
    'quickInput.foreground': fg,
    'quickInputTitle.background': card,
    'quickInputList.focusBackground': accent,
    'quickInputList.focusForeground': fg,

    'editorLink.activeForeground': s.keyword,
    'textLink.foreground': s.keyword,
    'textLink.activeForeground': pink,
    'textBlockQuote.background': card,
    'textBlockQuote.border': indigo,
    'textCodeBlock.background': card,
    'textPreformat.foreground': s.string,

    'widget.shadow': hex('0 0 0', 0.4),
  }

  const tokenColors = [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: s.comment, fontStyle: 'italic' },
    },
    {
      scope: ['string', 'string.quoted', 'string.template'],
      settings: { foreground: s.string },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.character'],
      settings: { foreground: s.number },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'storage.type',
        'storage.modifier',
        'keyword.operator.new',
        'keyword.operator.expression',
      ],
      settings: { foreground: s.keyword },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
      settings: { foreground: s.fn },
    },
    {
      scope: [
        'entity.name.class',
        'entity.name.type',
        'support.class',
        'support.type',
        'entity.other.inherited-class',
      ],
      settings: { foreground: s.type },
    },
    {
      scope: ['variable', 'variable.parameter', 'meta.definition.variable'],
      settings: { foreground: s.var },
    },
    {
      scope: [
        'variable.other.property',
        'variable.other.object.property',
        'meta.object-literal.key',
      ],
      settings: { foreground: s.prop },
    },
    {
      scope: ['punctuation', 'meta.brace', 'meta.delimiter'],
      settings: { foreground: mutedFg },
    },
    {
      scope: ['keyword.operator', 'punctuation.accessor'],
      settings: { foreground: s.op },
    },
    {
      scope: ['constant.character.escape', 'constant.other.placeholder'],
      settings: { foreground: s.number },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: s.attr },
    },
    {
      scope: ['entity.name.tag', 'meta.tag', 'punctuation.definition.tag'],
      settings: { foreground: s.tag },
    },
    {
      scope: ['markup.heading', 'markup.heading punctuation.definition.heading'],
      settings: { foreground: s.markup, fontStyle: 'bold' },
    },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    {
      scope: ['markup.inline.raw', 'markup.fenced_code', 'markup.raw'],
      settings: { foreground: s.string },
    },
    {
      scope: ['markup.underline.link', 'string.other.link'],
      settings: { foreground: s.fn, fontStyle: 'underline' },
    },
    { scope: ['markup.inserted', 'markup.changed'], settings: { foreground: s.string } },
    { scope: ['markup.deleted'], settings: { foreground: s.invalid } },
    {
      scope: ['invalid', 'invalid.illegal'],
      settings: { foreground: s.invalid, fontStyle: 'italic' },
    },
    { scope: ['emphasis'], settings: { fontStyle: 'italic' } },
    { scope: ['strong'], settings: { fontStyle: 'bold' } },
  ]

  const semanticTokenColors = {
    variable: s.var,
    parameter: s.var,
    property: s.prop,
    function: s.fn,
    method: s.fn,
    'function.declaration': s.fn,
    class: s.type,
    type: s.type,
    interface: s.type,
    enum: s.type,
    enumMember: s.number,
    typeParameter: s.type,
    namespace: s.type,
    macro: s.keyword,
    keyword: s.keyword,
    string: s.string,
    number: s.number,
    comment: { foreground: s.comment, fontStyle: 'italic' },
    'variable.readonly': s.var,
    'variable.defaultLibrary': s.type,
  }

  return {
    $schema: 'vscode://schemas/color-theme',
    name: p.label,
    type: p.type,
    semanticHighlighting: true,
    colors,
    tokenColors,
    semanticTokenColors,
  }
}

const contributes = []
for (const [id, palette] of Object.entries(PALETTES)) {
  const theme = buildTheme(palette)
  const filename = `cockpit-${id}-color-theme.json`
  writeFileSync(join(root, 'themes', filename), JSON.stringify(theme, null, 2) + '\n')
  contributes.push({
    label: palette.label,
    uiTheme: palette.type === 'light' ? 'vs' : 'vs-dark',
    path: `./themes/${filename}`,
  })
  console.log(`▸ themes/${filename}`)
}

writeFileSync(join(root, 'themes', '_contributes.json'), JSON.stringify(contributes, null, 2) + '\n')
console.log(`\n✓ ${contributes.length} тем сгенерировано`)
