import { TypedEmitter } from 'tiny-typed-emitter';

interface PollifyEvents<T extends unknown> {
  'data': (data: T, startTime: number) => void;
  'error': (error: Error) => void;
}

export interface PollifyOptions {
  /** The rate in milliseconds with which to execute pollFn. */
  rate?: number;
  /** The mode of the pollFn return type. */
  mode: 'promise' | 'callback' | 'return';
  regex?: string | RegExp;
};

/** The arguments pollFn should be called with. */
export type PollFunctionArgs = unknown[];

/** The function to be polled. The results of `pollFn()` will be emitted. */
export type PollFunction<T> = ((...fnArgs: PollFunctionArgs) => T);

/**
 * Produces an object that represents a stream of events generated by polling a provided function.
 */
export class Pollify<T extends unknown> extends TypedEmitter<PollifyEvents<T>> {
  /** The function run every time this polls. */
  pollFn: PollFunction<T>;
  /** Is this poll currently stopped? */
  stopped: boolean;
  /** Has this poll been run before? */
  firstRun: boolean;
  fnArgs: PollFunctionArgs;
  /** The rate in milliseconds with which to execute pollFn. */
  rate: number;
  /** The mode of the pollFn return type. */
  mode: string;

  constructor(options: PollifyOptions, pollFn: PollFunction<T>, ...fnArgs: PollFunctionArgs) {
    super();

    this.rate = options.rate ?? 0;
    this.mode = options.mode;
    this.stopped = false;
    this.firstRun = true;
    this.pollFn = pollFn;
    this.fnArgs = fnArgs;

    this.poll();
  }

  _promise(startTime: number) {
    const req = (this.pollFn as PollFunction<Promise<T>>)(...this.fnArgs).then((data: T) => {
      this.emit('data', data, startTime);
    }).catch((error: unknown) => this.emit('error', error as Error));

    // eslint-disable-next-line promise/catch-or-return
    req.then(() => this.rePoll(startTime));
  }

  _callback(startTime: number) {
    this.pollFn(...this.fnArgs, (error: unknown, data: T) => {
      if (error) {
        return this.emit('error', error as Error);
      }

      this.emit('data', data, startTime);
      this.rePoll(startTime);
    });
  }

  _return(startTime: number) {
    try {
      const data = this.pollFn(...this.fnArgs);
      this.emit('data', data, startTime);
    } catch (error: unknown) {
      this.emit('error', error as Error);
    }

    this.rePoll(startTime);
  }

  emit(event: keyof PollifyEvents<T>, ...args: [error: Error] | [data: T, startTime: number]) {
    if (this.firstRun) {
      setImmediate(() => super.emit(event, ...args));
      return true;
    }
    return super.emit(event, ...args);
  }

  poll() {
    if (this.stopped) return;

    const startTime = Date.now();
    if (this.mode === 'promise') this._promise(startTime);
    if (this.mode === 'callback') this._callback(startTime);
    if (this.mode === 'return') this._return(startTime);
    this.firstRun = false;
  }

  rePoll(startTime: number) {
    const timeDiff = this.rate - (Date.now() - startTime);

    if (timeDiff > 0) {
      return setTimeout(() => {
        this.poll();
      }, timeDiff);
    }

    return setImmediate(() => this.poll());
  }

  /**
   * Will start the event stream. Polls are started by default on construction.
   */
  start() {
    if (!this.stopped) return;

    this.stopped = false;
    this.poll();
  }

  /**
   * Will stop the event stream.
   */
  stop() {
    this.stopped = true;
  }
};

export default function<T>(options: PollifyOptions, pollFn: PollFunction<T>, ...fnArgs: PollFunctionArgs) {
  return new Pollify(options, pollFn, ...fnArgs);
};