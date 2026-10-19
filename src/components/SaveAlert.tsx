import { IconClose } from "./icons";

export type SaveFailure = {
  message: string;
  /** Re-runs the write that failed. */
  retry?: () => void;
};

/** A save that didn't go through has to be impossible to miss: a banner at the
 *  top of a long task list isn't visible on a phone scrolled halfway down, so
 *  this sits over the content and stays until it's dealt with. */
export function SaveAlert({ failure, onDismiss }: { failure: SaveFailure | null; onDismiss: () => void }) {
  if (!failure) return null;
  return (
    <div className="pl-toast save-alert" role="alert">
      <span>{failure.message}</span>
      {failure.retry && (
        <button type="button" onClick={failure.retry}>
          Try again
        </button>
      )}
      <button type="button" className="pl-toast-x" aria-label="Dismiss" onClick={onDismiss}>
        <IconClose />
      </button>
    </div>
  );
}
