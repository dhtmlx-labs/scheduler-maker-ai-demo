type RequestCancelDialogOptions = {
  dialog: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  continueButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  hasToolStarted: () => boolean;
  onStop: () => void;
};

export type RequestCancelDialogController = {
  close: () => void;
  open: () => void;
};

export function createRequestCancelDialog({
  dialog,
  title,
  body,
  continueButton,
  stopButton,
  hasToolStarted,
  onStop,
}: RequestCancelDialogOptions): RequestCancelDialogController {
  function close(): void {
    dialog.hidden = true;
  }

  function open(): void {
    title.textContent = "Stop current request?";
    body.textContent = hasToolStarted()
      ? "The assistant has already started processing scheduling operations. Any unfinished planning work from this request will be discarded."
      : "The assistant is still processing. Any unfinished work from this request will be discarded.";
    dialog.hidden = false;
    continueButton.focus();
  }

  continueButton.addEventListener("click", () => {
    close();
  });

  stopButton.addEventListener("click", () => {
    onStop();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
    }
  });

  return {
    close,
    open,
  };
}
