import { ipcMain, type IpcMainInvokeEvent } from 'electron';

let trustedPrefix = '';

/** Only pages whose URL starts with this prefix (our own UI) may call the main process. */
export const trustOrigin = (prefix: string) => {
  trustedPrefix = prefix;
};

export const handle = <A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedPrefix || !(event.senderFrame?.url ?? '').startsWith(trustedPrefix)) throw new Error('Untrusted sender');
    return fn(event, ...(args as A));
  });
