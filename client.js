/**
 * Composer list enhancement for the Web GUI.
 *
 * The resident composer is a plain-text Lexical editor: Enter sends,
 * Shift+Enter inserts a line break inside one paragraph, and nothing aligns a
 * list item's continuation with its text. This module adds four behaviours
 * without owning the editor:
 *
 * 1. Shift+Enter on a line that starts with `1. `, `1) `, `- `, `* `, `+ ` or
 *    `• ` writes the next item as its own paragraph and continues the
 *    numbering/bullet. An empty item leaves the list.
 * 2. A paragraph whose first line carries a list marker gets a hanging indent,
 *    so the text after the marker and every wrapped continuation line align.
 * 3. Tab / Shift+Tab on a list line indents or outdents that line by two
 *    spaces, so nested levels line up under the parent item's text.
 * 4. Ctrl+E moves the caret to the end of the current visual line.
 *
 * Draft edits go through the composer's own public input actions
 * (`captureInsertion` + `setDraft`), so Lexical state, persistence and the
 * submitted text stay canonical. They are only used on a chip-free plain-text
 * draft; every other posture keeps the shipped behaviour.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-composer-rich-input',
  factory(require) {
    const React = require('react');

    const EDITOR_SELECTOR = '[data-composer-input]';
    const OBSERVER_KEY = '__dshComposerRichInputObserver';
    const BUILD = 'v1.1.0';
    /** `1. `, `12) `, `- `, `* `, `+ `, `• ` with optional leading whitespace. */
    const MARKER_RE = /^([ \t]*)(?:(\d+)([.)])|([-*+•]))([ \t]+)(.*)$/;
    const INDENT = '  ';
    const HINT_MS = 12000;

    let hintShown = false;
    let measureCanvas = null;
    const widthCache = new Map();

    /**
     * Read one line as a list marker.
     * @param {string} line - the line text.
     * @returns {{ prefix: string, marker: string, gap: string, digits?: string, delimiter?: string, indent: string, content: string } | null}
     */
    function parseMarker(line) {
      const match = MARKER_RE.exec(line);
      if (match === null) return null;
      const indent = match[1] ?? '';
      const digits = match[2];
      const delimiter = match[3];
      const bullet = match[4];
      const gap = match[5] ?? ' ';
      const content = match[6] ?? '';
      const marker = digits === undefined ? bullet : digits + delimiter;
      return { prefix: indent + marker + gap, marker, gap, digits, delimiter, indent, content };
    }

    /** The next item's marker text, keeping indent, delimiter and bullet. */
    function nextMarker(parsed) {
      if (parsed.digits === undefined) return parsed.indent + parsed.marker + parsed.gap;
      return parsed.indent + String(Number(parsed.digits) + 1) + parsed.delimiter + parsed.gap;
    }

    /** Split a block's rendered lines (`<br>` included) into plain text. */
    function blockLines(block) {
      const lines = [''];
      const walk = (node) => {
        const children = node.childNodes;
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          if (child.nodeType === 3) lines[lines.length - 1] += child.data;
          else if (child.nodeName === 'BR') lines.push('');
          else if (child.nodeType === 1) walk(child);
        }
      };
      walk(block);
      return lines;
    }

    /** Measure `text` at the block's current font. */
    function measureWidth(text, element) {
      const style = window.getComputedStyle(element);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const key = `${font}\u0000${text}`;
      const cached = widthCache.get(key);
      if (cached !== undefined) return cached;
      if (measureCanvas === null) measureCanvas = document.createElement('canvas');
      const context = measureCanvas.getContext('2d');
      if (context === null) return 0;
      context.font = font;
      const width = context.measureText(text).width;
      if (widthCache.size > 512) widthCache.clear();
      widthCache.set(key, width);
      return width;
    }

    /**
     * Give every paragraph that opens with a list marker a hanging indent.
     * A paragraph holding more than one marker line is a pasted list: its
     * `<br>`-separated items cannot be aligned individually, so it is left
     * alone instead of indenting the wrong lines.
     */
    function applyHangingIndent(root) {
      if (!root.isConnected) return;
      const blocks = root.children;
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!(block instanceof HTMLElement)) continue;
        const lines = blockLines(block);
        const parsed = lines.length === 0 ? null : parseMarker(lines[0]);
        let width = null;
        if (parsed !== null) {
          let stacked = false;
          for (let line = 1; line < lines.length; line += 1) {
            if (parseMarker(lines[line]) !== null) {
              stacked = true;
              break;
            }
          }
          if (!stacked) width = measureWidth(parsed.prefix, block);
        }
        if (width === null) {
          if (block.style.paddingLeft !== '' || block.style.textIndent !== '') {
            block.style.removeProperty('padding-left');
            block.style.removeProperty('text-indent');
          }
        } else {
          const padding = `${width}px`;
          const indent = `-${width}px`;
          if (block.style.paddingLeft !== padding || block.style.textIndent !== indent) {
            block.style.paddingLeft = padding;
            block.style.textIndent = indent;
          }
        }
      }
    }

    /** The editor's current plain text (paragraph gaps and `<br>` are newlines). */
    function readDraft(root) {
      const lines = [];
      const blocks = root.children;
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!(block instanceof HTMLElement)) continue;
        for (const line of blockLines(block)) lines.push(line);
      }
      return lines.join('\n');
    }

    /** Collapse the DOM caret onto one text offset inside `node`. */
    function collapseAt(node, offset) {
      const selection = window.getSelection();
      if (selection === null) return false;
      const range = document.createRange();
      range.setStart(node, Math.min(offset, node.data.length));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    /** Put the DOM caret on a plain-text offset of the rebuilt draft. */
    function placeCaret(root, text, offset) {
      const limit = Math.max(0, Math.min(offset, text.length));
      let line = 0;
      let lineStart = 0;
      for (let index = 0; index < limit; index += 1) {
        if (text.charCodeAt(index) === 10) {
          line += 1;
          lineStart = index + 1;
        }
      }
      const block = root.children[line];
      if (!(block instanceof HTMLElement)) return false;
      let remaining = limit - lineStart;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        if (remaining <= node.data.length) return collapseAt(node, remaining);
        remaining -= node.data.length;
        node = walker.nextNode();
      }
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      const selection = window.getSelection();
      if (selection === null) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    /** Move the caret to the end of the current visual line. */
    function moveToLineEnd(root) {
      const selection = window.getSelection();
      if (selection === null) return;
      if (typeof selection.modify === 'function' && selection.rangeCount > 0) {
        selection.modify('move', 'forward', 'lineboundary');
        return;
      }
      const node = selection.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement ?? null;
      const block = element?.closest('p') ?? root.lastElementChild ?? root;
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    /** One-time gesture hint below the composer; also a liveness signal. */
    function ComposerListsHint() {
      const [visible, setVisible] = React.useState(() => !hintShown);
      React.useEffect(() => {
        if (!visible) return undefined;
        hintShown = true;
        const timer = window.setTimeout(() => setVisible(false), HINT_MS);
        return () => window.clearTimeout(timer);
      }, [visible]);
      if (!visible) return null;
      const zh = (navigator.language || '').toLowerCase().startsWith('zh');
      return React.createElement(
        'div',
        {
          'data-composer-lists-hint': BUILD,
          style: {
            color: 'var(--dsw-alias-label-tertiary)',
            fontSize: '12px',
            lineHeight: '18px',
            textAlign: 'center',
            padding: '2px 8px 6px',
            userSelect: 'none',
          },
        },
        zh
          ? `${BUILD} 已加载：Shift+Enter 续列表 · Tab/Shift+Tab 缩进 · Ctrl+E（或 Ctrl+Shift+E）行尾`
          : `${BUILD} ready: Shift+Enter continues a list · Tab/Shift+Tab indents · Ctrl+E / Ctrl+Shift+E line end`,
      );
    }

    /** Headless behaviour seat: listens on the document and renders nothing. */
    function ComposerRichInput(props) {
      const input = typeof props.useInput === 'function' ? props.useInput((state) => state) : null;
      const live = React.useRef({ input, actions: props.inputActions });
      live.current.input = input;
      live.current.actions = props.inputActions;

      React.useEffect(() => {
        const diag = (window.__dshComposerLists ??= { build: BUILD, mounts: 0, keys: 0 });
        diag.build = BUILD;
        diag.mounts += 1;
        const watched = new Set();
        const dirty = new Set();
        let frame = 0;

        const flush = () => {
          frame = 0;
          for (const root of dirty) applyHangingIndent(root);
          dirty.clear();
        };

        const schedule = (root) => {
          if (!root.isConnected) return;
          dirty.add(root);
          if (frame === 0) frame = window.requestAnimationFrame(flush);
        };

        const watch = (root) => {
          if (watched.has(root)) return;
          watched.add(root);
          const observer = new MutationObserver(() => schedule(root));
          observer.observe(root, { childList: true, characterData: true, subtree: true });
          root[OBSERVER_KEY] = observer;
          schedule(root);
        };

        const editorOf = (target) => {
          const root = target instanceof Element ? target.closest(EDITOR_SELECTOR) : null;
          return root instanceof HTMLElement && root.isContentEditable ? root : null;
        };

        /** Rewrite the draft, then put the caret back on the requested offset. */
        const rewrite = (root, actions, next, caret) => {
          actions.setDraft(next);
          window.requestAnimationFrame(() => placeCaret(root, next, caret));
        };

        const onKeyDown = (event) => {
          if (event.defaultPrevented || event.isComposing) return;
          diag.keys += 1;
          diag.lastKey = `${event.key}${event.shiftKey ? '+Shift' : ''}${event.ctrlKey ? '+Ctrl' : ''}`;
          const root = editorOf(event.target);
          if (root === null) return;

          if (
            (event.key === 'e' || event.key === 'E') &&
            event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            try {
              moveToLineEnd(root);
            } catch {
              /* Keeping the current caret is safer than a half-applied move. */
            }
            return;
          }

          if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            // The trigger menu arbitrates Tab itself while it is open.
            if (document.querySelector('[data-trigger-menu]') !== null) return;
            const tabState = live.current.input;
            const tabActions = live.current.actions;
            if (tabState === null || tabState === undefined || tabActions === null || tabActions === undefined) return;
            if (typeof tabActions.captureInsertion !== 'function' || typeof tabActions.setDraft !== 'function') return;
            if (tabState.phase !== 'plain') return;
            if (Array.isArray(tabState.occurrences) && tabState.occurrences.length > 0) return;
            const tabDraft = readDraft(root);
            if (tabDraft === '') return;
            const tabSpan = tabActions.captureInsertion();
            if (tabSpan === null || tabSpan === undefined || tabSpan.start !== tabSpan.end) return;
            if (tabSpan.start > tabDraft.length) return;
            const lineStart = tabDraft.lastIndexOf('\n', tabSpan.start - 1) + 1;
            const lineEnd = tabDraft.indexOf('\n', lineStart);
            const line = tabDraft.slice(lineStart, lineEnd < 0 ? tabDraft.length : lineEnd);
            if (parseMarker(line) === null) return;
            event.preventDefault();
            event.stopPropagation();
            const tail = lineEnd < 0 ? '' : tabDraft.slice(lineEnd);
            if (event.shiftKey) {
              const remove = line.startsWith(INDENT) ? INDENT.length : line.startsWith(' ') ? 1 : 0;
              if (remove === 0) return;
              rewrite(
                root,
                tabActions,
                tabDraft.slice(0, lineStart) + line.slice(remove) + tail,
                Math.max(lineStart, tabSpan.start - remove),
              );
              return;
            }
            rewrite(
              root,
              tabActions,
              tabDraft.slice(0, lineStart) + INDENT + tabDraft.slice(lineStart),
              tabSpan.start + INDENT.length,
            );
            return;
          }

          if (event.key !== 'Enter' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
            return;
          }
          const state = live.current.input;
          const actions = live.current.actions;
          if (state === null || state === undefined || actions === null || actions === undefined) return;
          if (typeof actions.captureInsertion !== 'function' || typeof actions.setDraft !== 'function') return;
          if (state.phase !== 'plain') return;
          if (Array.isArray(state.occurrences) && state.occurrences.length > 0) return;
          const draft = readDraft(root);
          if (draft === '') return;

          const span = actions.captureInsertion();
          if (span === null || span === undefined || span.start !== span.end) return;
          if (span.start !== draft.length) return;

          const lineStart = draft.lastIndexOf('\n', span.start - 1) + 1;
          const parsed = parseMarker(draft.slice(lineStart));
          if (parsed === null) return;

          event.preventDefault();
          event.stopPropagation();
          const next =
            parsed.content.trim() === ''
              ? draft.slice(0, lineStart) + '\n'
              : draft + '\n' + nextMarker(parsed);
          actions.setDraft(next);
        };

        const onFocusIn = (event) => {
          const root = editorOf(event.target);
          if (root !== null) watch(root);
        };

        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('focusin', onFocusIn, true);
        for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) watch(editor);

        return () => {
          document.removeEventListener('keydown', onKeyDown, true);
          document.removeEventListener('focusin', onFocusIn, true);
          if (frame !== 0) window.cancelAnimationFrame(frame);
          for (const root of watched) {
            const observer = root[OBSERVER_KEY];
            if (observer !== undefined) {
              observer.disconnect();
              delete root[OBSERVER_KEY];
            }
          }
          watched.clear();
          dirty.clear();
        };
      }, []);

      return null;
    }

    /** Keep a render failure inside this seat instead of the composer subtree. */
    class RenderGuard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }

    function ComposerListsSeat(props) {
      return React.createElement(
        RenderGuard,
        null,
        React.createElement(ComposerRichInput, props),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.overlay', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'composer-rich-input',
              order: 50,
            },
            ComposerListsSeat,
          ),
        );
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'composer-lists-hint',
              order: 90,
            },
            ComposerListsHint,
          ),
        );
      },
    };
  },
});
