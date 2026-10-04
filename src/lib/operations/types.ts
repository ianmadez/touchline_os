/**
 * Transport-agnostic operation results.
 *
 * An "operation" is what used to be the body of an API route: it takes plain values, returns plain
 * values, and never touches `Request` or `NextResponse`. The local Node build translates a result
 * back into an HTTP response - byte-for-byte what the route returned before - while the browser
 * build reads `body` directly with no HTTP hop in between.
 *
 * `status` exists so one implementation keeps the local target's exact status codes. It is not a
 * claim that a browser call is an HTTP call.
 */
export interface OperationResult<T> {
  status: number;
  body: T;
}

/** The error envelope almost every route already returns. */
export interface OperationErrorBody {
  success: false;
  error: string;
  message?: string;
}

/** A 200 result. */
export function ok<T>(body: T): OperationResult<T> {
  return { status: 200, body };
}

/** A result with an explicit status. */
export function at<T>(status: number, body: T): OperationResult<T> {
  return { status, body };
}

/** An error envelope, with the extra `message` field only when one is supplied. */
export function failed(
  status: number,
  error: string,
  message?: string
): OperationResult<OperationErrorBody> {
  return {
    status,
    body: message === undefined ? { success: false, error } : { success: false, error, message },
  };
}
