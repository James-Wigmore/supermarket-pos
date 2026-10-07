import type { PosBridge } from '../../../desktop/bridge';

declare global {
  interface Window {
    /** Present only inside the Windows desktop app. */
    pos?: PosBridge;
  }
}

export const isDesktop = () => Boolean(window.pos);

/** Electron prefixes errors thrown in the main process; show only the message. */
export const ipc = <T>(call: Promise<T>) =>
  call.catch((err: Error) => {
    throw new Error(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  });

/** Prints the page (receipt): through the desktop app (chosen printer, optionally silent) or the browser. */
export const printPage = () => (window.pos ? ipc(window.pos.print()).catch((err: Error) => window.alert(err.message)) : Promise.resolve(window.print()));
