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
  validate?: (value: string) => string | null;
  value?: string;
}

let sequence = 0;
let dismissActive: (() => void) | null = null;

function button(label: string, kind: 'cancel' | 'confirm', tone: DialogTone) {
  const element = document.createElement('button');
  element.className = `ui-dialog__button ui-dialog__button--${kind}`;
  element.dataset.tone = tone;
  element.type = 'button';
  element.textContent = label;
  return element;
}

function openDialog(kind: 'alert' | 'confirm' | 'prompt', options: DialogOptions | PromptOptions) {
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
  }

  const actions = document.createElement('div');
  actions.className = 'ui-dialog__actions';
  const tone = options.tone ?? 'default';
  const cancel = kind === 'alert' ? null : button(options.cancelLabel ?? 'Cancel', 'cancel', tone);
  const confirm = button(options.confirmLabel ?? (kind === 'alert' ? 'OK' : 'Confirm'), 'confirm', tone);
  if (cancel) actions.append(cancel);
  actions.append(confirm);
  surface.append(actions);
  dialog.append(surface);
  document.body.append(dialog);

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      dismissActive = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(result);
    };
    dismissActive = () => finish(null);
    cancel?.addEventListener('click', () => finish(null));
    confirm.addEventListener('click', () => {
      if (kind === 'prompt' && input) {
        const issue = (options as PromptOptions).validate?.(input.value) ?? null;
        if (issue) {
          input.setAttribute('aria-invalid', 'true');
          if (inputError) inputError.textContent = issue;
          input.focus();
          return;
        }
        finish(input.value);
        return;
      }
      finish('confirmed');
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirm.click();
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null);
    });
    dialog.showModal();
    (input ?? cancel ?? confirm).focus();
  });
}

export async function alertUi(options: DialogOptions) {
  await openDialog('alert', options);
}

export async function confirmUi(options: DialogOptions) {
  return (await openDialog('confirm', options)) !== null;
}

export function promptUi(options: PromptOptions) {
  return openDialog('prompt', options);
}
