import { render, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { FindLogProvider, useFindLog } from "./FindLogContext";
import type { FindStore } from "./findStore";

const fakeStore = { list: async () => [] } as unknown as FindStore;

function wrapper(open: () => Promise<FindStore>) {
  return ({ children }: { children: ReactNode }) => (
    <FindLogProvider open={open}>{children}</FindLogProvider>
  );
}

describe("FindLogProvider", () => {
  it("opens the find log only when it is first asked for, and once however often it is asked", async () => {
    const open = jest.fn(async () => fakeStore);
    const { result } = await renderHook(() => useFindLog(), { wrapper: wrapper(open) });
    expect(open).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([result.current(), result.current()]);
    expect(first).toBe(fakeStore);
    expect(second).toBe(fakeStore);
    await result.current();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens it again on the next ask after an opening failed", async () => {
    const open = jest
      .fn<Promise<FindStore>, []>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(fakeStore);
    const { result } = await renderHook(() => useFindLog(), { wrapper: wrapper(open) });
    await expect(result.current()).rejects.toThrow("disk full");
    await expect(result.current()).resolves.toBe(fakeStore);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("gives the same function on every render", async () => {
    const open = jest.fn(async () => fakeStore);
    const { result, rerender } = await renderHook(() => useFindLog(), { wrapper: wrapper(open) });
    const before = result.current;
    await rerender({});
    expect(result.current).toBe(before);
  });
});

describe("useFindLog", () => {
  it("throws outside a FindLogProvider", async () => {
    function Outside() {
      useFindLog();
      return null;
    }
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Outside />)).rejects.toThrow(
      "useFindLog must be used inside a FindLogProvider",
    );
    spy.mockRestore();
  });
});
