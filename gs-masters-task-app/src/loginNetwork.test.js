import { withLoginTimeout, loginErrorMessage } from "./loginNetwork";

test("completed login requests return normally", async () => {
  const operation = jest.fn().mockResolvedValue([{ id: "crew-1" }]);
  await expect(withLoginTimeout(operation, 100)).resolves.toEqual([{ id: "crew-1" }]);
  expect(operation).toHaveBeenCalledWith(expect.any(AbortSignal));
});

test("a stalled directory request times out and aborts", async () => {
  jest.useFakeTimers();
  try {
    let signal;
    const operation = jest.fn(s => {
      signal = s;
      return new Promise(() => {});
    });
    const pending = withLoginTimeout(operation, 25);
    await Promise.resolve();
    jest.advanceTimersByTime(25);
    await expect(pending).rejects.toMatchObject({ code: "login_timeout" });
    expect(signal.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("correctly distinguishes unavailable service, denied access and wrong PIN", () => {
  expect(loginErrorMessage({ code: "login_timeout" }, "en")).toMatch(/service unavailable/i);
  expect(loginErrorMessage({ status: 503 }, "es")).toMatch(/servicio de campo/i);
  expect(loginErrorMessage({ status: 403 }, "en")).toMatch(/access denied/i);
  expect(loginErrorMessage({ message: "auth_failed" }, "en", true)).toMatch(/wrong PIN/i);
  expect(loginErrorMessage({ message: "auth_failed" }, "en")).toMatch(/invalid credentials/i);
});
