// CodeMirror 6 bundle for Git-Werkstatt (built once with esbuild, see vendor/README.md)
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, Decoration, WidgetType, ViewPlugin, placeholder, gutter, GutterMarker } from '@codemirror/view';
export { EditorState, Compartment, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, StreamLanguage, foldGutter } from '@codemirror/language';
export { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { tags } from '@lezer/highlight';
export { html } from '@codemirror/lang-html';
export { css } from '@codemirror/lang-css';
export { javascript } from '@codemirror/lang-javascript';
export { markdown } from '@codemirror/lang-markdown';
export { python } from '@codemirror/lang-python';
export { java } from '@codemirror/lang-java';
export { sql } from '@codemirror/lang-sql';
export { yaml } from '@codemirror/lang-yaml';
export { shell } from '@codemirror/legacy-modes/mode/shell';
export { properties } from '@codemirror/legacy-modes/mode/properties';
export { diff } from '@codemirror/legacy-modes/mode/diff';
