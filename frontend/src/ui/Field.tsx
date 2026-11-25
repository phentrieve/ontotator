import { cloneElement, type ReactElement, type ReactNode } from "react";
import { HelpButton, HelpText, useHelp } from "./Help";

export interface FieldOwn {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /**
   * An explanation on demand (issue 556): a (?) after the label that opens this text under it. `topic` names the
   * button ("Help: Reason"); a hint that fits goes into the placeholder instead.
   */
  help?: { topic: string; content: ReactNode };
}

interface ControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
}

export interface FieldProps extends FieldOwn {
  required?: boolean;
  children: ReactElement<ControlProps>;
}

export function Field({ id, label, hint, error, required, help, children }: FieldProps) {
  const helpState = useHelp();
  const hasHint = hint != null && hint !== false && hint !== "";
  const hasError = !!error;
  const isRequired = required ?? children.props.required;
  const describedBy = [...new Set([
    ...(children.props["aria-describedby"]?.split(/\s+/).filter(Boolean) ?? []),
    ...(hasHint ? [`${id}-hint`] : []),
    ...(hasError ? [`${id}-error`] : []),
  ])].join(" ") || undefined;
  const labelElement = <label className="form-label" htmlFor={id}>{label}{isRequired && " (required)"}</label>;

  return (
    <div className="form-group">
      {help ? <div className="form-label-row">{labelElement}<HelpButton help={helpState} topic={help.topic} /></div> : labelElement}
      {help && <HelpText help={helpState}>{help.content}</HelpText>}
      {cloneElement(children, { id, required: isRequired, "aria-describedby": describedBy, "aria-invalid": hasError })}
      {hasHint && <div id={`${id}-hint`} className="field-hint">{hint}</div>}
      {hasError && <div id={`${id}-error`} className="field-hint field-hint-error" role="alert">{error}</div>}
    </div>
  );
}
