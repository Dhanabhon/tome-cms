import { animateDismissals, closeOverlay } from './overlay-motion';

type DialogTone = 'default' | 'danger';

interface DialogOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  message: string;
  title: string;
  tone?: DialogTone;
}

interface PromptOptions extends DialogOptions {
  label: string;
  /** A second way to answer, beside Cancel and the confirm button: it skips validation and says so in the answer. */
  secondary?: { label: string };
  validate?: (value: string) => string | null;
  value?: string;
}

/** A prompt that also asks one yes-or-no question, as a checkbox under its field. */
interface ToggledPromptOptions extends PromptOptions {
  toggle: { checked: boolean; label: string };
}

/**
 * What a dialog was answered with: the field's value and whether its checkbox was ticked, or
 * that the secondary action was chosen instead (and so there is no value to read).
 */
export type DialogAnswer = { checked: boolean; secondary: false; value: string } | { checked: boolean; secondary: true };

export function dialogAnswer(secondary: boolean, checked: boolean, value: string): DialogAnswer {
  return secondary ? { checked, secondary: true } : { checked, secondary: false, value };
}

let sequence = 0;
let dismissActive: (() => void) | null = null;

function button(label: string, kind: 'cancel' | 'confirm' | 'secondary', tone: DialogTone) {
  const element = document.createElement('button');
  element.className = `ui-dialog__button ui-dialog__button--${kind}`;
  element.dataset.tone = tone;
  element.type = 'button';
  element.textContent = label;
  return element;
}

function openDialog(kind: 'alert' | 'confirm' | 'prompt', options: DialogOptions | PromptOptions | ToggledPromptOptions) {
  dismissActive?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  const id = `ui-dialog-${++sequence}`;
  dialog.className = 'ui-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-message`);
  dialog.setAttribute('aria-modal', 'true');
  if (kind === 'alert') dialog.setAttribute('role', 'alertdialog');

  const surface = document.createElement('div');
  surface.className = 'ui-dialog__surface';
  const title = document.createElement('h2');
  title.id = `${id}-title`;
  title.textContent = options.title;
  const message = document.createElement('p');
  message.className = 'ui-dialog__message';
  message.id = `${id}-message`;
  message.textContent = options.message;
  surface.append(title, message);

  let input: HTMLInputElement | null = null;
  let inputError: HTMLParagraphElement | null = null;
  let toggle: HTMLInputElement | null = null;
  if (kind === 'prompt') {
    const promptOptions = options as PromptOptions;
    const field = document.createElement('label');
    field.className = 'ui-dialog__field';
    const label = document.createElement('span');
    label.textContent = promptOptions.label;
    input = document.createElement('input');
    input.className = 'ui-dialog__input';
    input.value = promptOptions.value ?? '';
    input.setAttribute('aria-describedby', `${id}-error`);
    inputError = document.createElement('p');
    inputError.className = 'ui-dialog__error';
    inputError.id = `${id}-error`;
    inputError.setAttribute('aria-live', 'polite');
    input.addEventListener('input', () => {
      input?.removeAttribute('aria-invalid');
      if (inputError) inputError.textContent = '';
    });
    field.append(label, input, inputError);
    surface.append(field);

    const question = (options as Partial<ToggledPromptOptions>).toggle;
    if (question) {
      const check = document.createElement('label');
      check.className = 'ui-dialog__check';
      toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = question.checked;
      const text = document.createElement('span');
      text.textContent = question.label;
      check.append(toggle, text);
      surface.append(check);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'ui-dialog__actions';
  const tone = options.tone ?? 'default';
  const cancel = kind === 'alert' ? null : button(options.cancelLabel ?? 'Cancel', 'cancel', tone);
  const confirm = button(options.confirmLabel ?? (kind === 'alert' ? 'OK' : 'Confirm'), 'confirm', tone);
  const secondaryLabel = kind === 'prompt' ? (options as PromptOptions).secondary?.label : undefined;
  const secondary = secondaryLabel ? button(secondaryLabel, 'secondary', tone) : null;
  if (secondary) actions.append(secondary);
  if (cancel) actions.append(cancel);
  actions.append(confirm);
  surface.append(actions);
  dialog.append(surface);
  document.body.append(dialog);

  return new Promise<DialogAnswer | null>((resolve) => {
    let answer: DialogAnswer | null = null;
    let settled = false;
    // The answer is fixed by the first way out -- a click on a leaving dialog changes nothing --
    // and the caller hears it once the exit has played and the focus is back where it was, so
    // nothing the caller does next is undone by that.
    const finish = (result: DialogAnswer | null) => {
      if (settled || !dialog.open || 'closing' in dialog.dataset) return;
      settled = true;
      answer = result;
      void closeOverlay(dialog);
    };
    const dismiss = () => finish(null);
    dismissActive = dismiss;
    // Every way it closes ends here, Escape included, whether or not the page could hold it back.
    dialog.addEventListener('close', () => {
      if (dismissActive === dismiss) dismissActive = null;
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(answer);
    }, { once: true });
    animateDismissals(dialog);
    cancel?.addEventListener('click', () => finish(null));
    secondary?.addEventListener('click', () => finish(dialogAnswer(true, toggle?.checked ?? false, '')));
    confirm.addEventListener('click', () => {
      if (kind === 'prompt' && input) {
        const issue = (options as PromptOptions).validate?.(input.value) ?? null;
        if (issue) {
          input.setAttribute('aria-invalid', 'true');
          if (inputError) inputError.textContent = issue;
          input.focus();
          return;
        }
        finish(dialogAnswer(false, toggle?.checked ?? false, input.value));
        return;
      }
      finish(dialogAnswer(false, false, ''));
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirm.click();
      }
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null);
    });
    dialog.showModal();
    (input ?? cancel ?? confirm).focus();
  });
}

/** Every button is named by its caller, in the admin's language: there is no English to fall back on. */
type Labelled<T> = T & { cancelLabel: string; confirmLabel: string };

export async function alertUi(options: DialogOptions & { confirmLabel: string }) {
  await openDialog('alert', options);
}

export async function confirmUi(options: Labelled<DialogOptions>) {
  return (await openDialog('confirm', options)) !== null;
}

export async function promptUi(options: Labelled<Omit<PromptOptions, 'secondary'>>) {
  const answer = await openDialog('prompt', options);
  return answer && !answer.secondary ? answer.value : null;
}

/** A prompt with one checkbox under its field: what was typed, and whether the box was ticked. */
export function promptWithToggleUi(options: Labelled<ToggledPromptOptions>) {
  return openDialog('prompt', options);
}
