import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Link2 } from 'lucide-react';
import { Popover, Button } from '@/components/ui';

export interface RichEditorHandle {
  insert: (text: string) => void;
  focus: () => void;
}

/** Minimal rich-text editor (contentEditable): bold, italic, links, variable insertion. */
export const RichEditor = forwardRef<RichEditorHandle, { value: string; onChange: (html: string) => void; variables: string[]; label: string; minHeight?: number; disabled?: boolean }>(function RichEditor({ value, onChange, variables, label, minHeight = 240, disabled }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);

  // Only push external value into the DOM when it differs (keeps the caret stable while typing).
  useEffect(() => {
    if (el.current && el.current.innerHTML !== value) el.current.innerHTML = value;
  }, [value]);

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) lastRange.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    el.current?.focus();
    const sel = window.getSelection();
    if (lastRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(lastRange.current);
    }
  };
  const emit = () => onChange(el.current?.innerHTML ?? '');
  const exec = (cmd: string, arg?: string) => {
    restoreRange();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const insert = (text: string) => {
    restoreRange();
    document.execCommand('insertText', false, text);
    saveRange();
    emit();
  };
  useImperativeHandle(ref, () => ({ insert, focus: () => el.current?.focus() }));

  return (
    <div>
      <div className="-mb-px flex items-center gap-1 rounded-t-lg border border-b-0 border-line p-1">
        <Button size="sm" icon variant="ghost" aria-label="Bold" className="h-8 w-8 font-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} disabled={disabled}>
          B
        </Button>
        <Button size="sm" icon variant="ghost" aria-label="Italic" className="h-8 w-8 italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} disabled={disabled}>
          I
        </Button>
        <Button
          size="sm"
          icon
          variant="ghost"
          aria-label="Insert link"
          className="h-8 w-8"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            saveRange();
            const url = window.prompt('Link URL', 'https://');
            if (url && /^https?:\/\//i.test(url)) exec('createLink', url);
          }}
        >
          <Link2 className="h-4 w-4" aria-hidden />
        </Button>
        <span className="flex-1" />
        <Popover
          width={220}
          trigger={({ toggle, ref: r, open }) => (
            <Button ref={r} size="sm" variant="ghost" className="h-8 text-[13px] text-accent" aria-expanded={open} disabled={disabled} onMouseDown={(e) => { e.preventDefault(); saveRange(); }} onClick={toggle}>
              <span className="font-mono">{'{ }'}</span>Variables
            </Button>
          )}
        >
          {(close) => (
            <div className="max-h-72 overflow-y-auto">
              {variables.map((v) => (
                <button
                  key={v}
                  className="block w-full rounded-md px-3 py-1.5 text-left font-mono text-[13px] hover:bg-[#F4F4F5]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    close();
                    insert(`{{${v}}}`);
                  }}
                >
                  {`{{${v}}}`}
                </button>
              ))}
              <div className="mt-1 border-t border-soft px-3 py-2 text-xs text-muted">
                Fallback: <span className="font-mono">{'{{firstName | there}}'}</span>
                <br />
                Spintax: <span className="font-mono">{'{spin: Hi | Hello}'}</span>
              </div>
            </div>
          )}
        </Popover>
      </div>
      <div
        ref={el}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable={!disabled}
        suppressContentEditableWarning
        className="rte rounded-b-lg border border-line px-4 py-3.5 text-sm leading-[1.7] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
        style={{ minHeight }}
        onInput={emit}
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        onBlur={saveRange}
        onPaste={(e) => {
          // paste as plain text to avoid foreign markup in emails
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
});
