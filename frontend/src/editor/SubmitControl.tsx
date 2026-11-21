import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { IconArrowRight, IconCheck } from "../ui/icons";

export interface SubmitControlProps {
  onSubmit: () => void;
  disabled: boolean;
  pending: boolean;
  /** Open items of the submit dialog; the label shows the count while it is above 0. */
  openCount?: number | null;
  /** Goes to the next open item; shown next to the button while items are open. */
  onNextOpen?: () => void;
  /** The case bar shares its line with the app header (issue 539): "Next open item" is an icon with that name. */
  compact?: boolean;
}

/** Toolbar control that starts the case submission, with the remaining open items. */
export function SubmitControl({ onSubmit, disabled, pending, openCount = null, onNextOpen, compact = false }: SubmitControlProps) {
  const open = openCount !== null && openCount > 0;
  return (
    <>
      {open && onNextOpen && (compact
        ? <IconButton size="sm" label="Next open item" icon={<IconArrowRight />} onClick={onNextOpen} />
        : <Button type="button" size="sm" onClick={onNextOpen}>
          Next open item
        </Button>
      )}
      <Button
        type="button"
        variant="primary" size="sm"
        data-finish-submit
        onClick={onSubmit}
        disabled={disabled}
        aria-busy={pending}
        title={pending ? "Saving changes before submitting" : "Finish and submit text"}
      >
        <IconCheck />
        {open ? `Finish & submit (${openCount} open)` : "Finish & submit text"}
      </Button>
    </>
  );
}
