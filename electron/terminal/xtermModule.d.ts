declare module "@xterm/xterm/lib/xterm.js" {
  import type { Terminal } from "@xterm/xterm";

  const xtermModule: {
    Terminal: typeof Terminal;
  };

  export default xtermModule;
}
