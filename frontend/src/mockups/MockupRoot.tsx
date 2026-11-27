/**
 * Mockups for the owner's sign-off, shown with `?mockup=<name>` in a dev build (`npm run dev`) only: main.tsx loads
 * this module behind `import.meta.env.DEV`, so a production build contains none of it. Synthetic data, no API.
 */
import { PairingMockup } from "./PairingMockup";

const MOCKUPS: Record<string, () => JSX.Element> = { pairing: PairingMockup };

export function MockupRoot({ name }: { name: string }): JSX.Element {
  const Mockup = MOCKUPS[name];
  return Mockup ? <Mockup /> : <p>No mockup named “{name}”. Known: {Object.keys(MOCKUPS).join(", ")}.</p>;
}
