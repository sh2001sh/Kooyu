import { type InputHTMLAttributes } from "react";

/** Use the browser's validated calendar/clock instead of accepting date text. */
export function DateTimeSelection(props: InputHTMLAttributes<HTMLInputElement>) {
  const open = (input: HTMLInputElement) => {
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        // A browser without picker support retains its native date control.
      }
    }
  };
  return (
    <input
      {...props}
      onClick={(event) => open(event.currentTarget)}
      onBeforeInput={(event) => event.preventDefault()}
      onPaste={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (["Tab", "Escape"].includes(event.key)) return;
        event.preventDefault();
        if (["Enter", " ", "ArrowDown"].includes(event.key)) open(event.currentTarget);
      }}
    />
  );
}
