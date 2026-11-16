import { act, render, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ShareProvider, useShare } from "./ShareContext";
import type { ShareDeps } from "./shareSession";

jest.mock("expo-sharing", () => ({
  getSharedPayloads: jest.fn(() => []),
  getResolvedSharedPayloadsAsync: jest.fn(async () => []),
  clearSharedPayloads: jest.fn(),
}));
// Loaded with the device picker, whose image check is the provider's default.
jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

const image = (value: string) => ({ value, shareType: "image", mimeType: "image/jpeg" });
const A = "content://media/external/images/media/1";
const B = "content://media/external/images/media/2";
const copyOf = (value: string) => `file:///cache/expo-sharing/${value.slice(-1)}/photo.jpg`;
const SHARE_ADDRESS = "what-mushroom-is-this://expo-sharing";

/**
 * A provider over a stand-in for the library, with the addresses that reach the app from outside
 * it as the test sends them.
 */
function setUp(initial: unknown[] = []) {
  const lib = { shared: initial as unknown[] };
  const listeners: ((event: { url: string }) => void)[] = [];
  let removed = 0;
  const deps: ShareDeps = {
    source: {
      read: jest.fn(() => lib.shared),
      resolve: jest.fn(async () =>
        (lib.shared as { value: string }[]).map((payload) => ({
          ...payload,
          contentUri: copyOf(payload.value),
          contentType: "image",
        })),
      ),
      clear: jest.fn(() => {
        lib.shared = [];
      }),
    },
    files: {
      libraryCopy: (uri) => uri,
      keep: (uri) => uri.replace("/expo-sharing/", "/SharedPhotos/"),
      remove: jest.fn(),
    },
    loadsAsImage: async () => true,
  };
  const linking = {
    addEventListener: (_: "url", listener: (event: { url: string }) => void) => {
      listeners.push(listener);
      return {
        remove: () => {
          removed += 1;
        },
      };
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ShareProvider deps={deps} linking={linking}>
      {children}
    </ShareProvider>
  );
  /** An address reaches the app from outside it while it runs. */
  const addressArrives = async (url: unknown): Promise<void> => {
    await act(async () => {
      for (const listener of listeners) {
        listener({ url } as { url: string });
      }
    });
    await settle();
  };
  return { lib, deps, listeners, removed: () => removed, wrapper, addressArrives };
}

/** Lets the provider's reading of a share run to its end. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  });
}

describe("ShareProvider (SPEC 3.9, Shared photos)", () => {
  it("does not look for a share by itself when it is first shown: one the library kept from an earlier run is not read again", async () => {
    const { deps, wrapper } = setUp([image(A)]);
    const { result } = await renderHook(() => useShare(), { wrapper });
    await settle();
    expect(result.current.state).toEqual({ kind: "none" });
    expect(deps.source.read).not.toHaveBeenCalled();
    expect(deps.source.resolve).not.toHaveBeenCalled();
  });

  it("reads the share when a screen asks it to look, as the choice does when it opens", async () => {
    const { wrapper } = setUp([image(A)]);
    const { result } = await renderHook(() => useShare(), { wrapper });
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    expect(result.current.state).toMatchObject({ kind: "ready", photos: [copyOf(A)] });
  });

  it("holds no share when the library holds none", async () => {
    const { deps, wrapper } = setUp();
    const { result } = await renderHook(() => useShare(), { wrapper });
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    expect(result.current.state).toEqual({ kind: "none" });
    expect(deps.source.resolve).not.toHaveBeenCalled();
  });

  it("reads a share when the library's share address reaches the app while it runs", async () => {
    const { lib, wrapper, addressArrives } = setUp();
    const { result } = await renderHook(() => useShare(), { wrapper });
    await settle();
    lib.shared = [image(B)];
    await addressArrives(SHARE_ADDRESS);
    expect(result.current.state).toMatchObject({ kind: "ready", photos: [copyOf(B)] });
  });

  it.each([
    "what-mushroom-is-this://settings",
    "what-mushroom-is-this://",
    "https://example.org/expo-sharing",
    undefined,
    7,
  ])("does not look for a share when the address %p reaches the app", async (address) => {
    const { lib, deps, wrapper, addressArrives } = setUp();
    const { result } = await renderHook(() => useShare(), { wrapper });
    await settle();
    lib.shared = [image(A)];
    await addressArrives(address);
    expect(result.current.state).toEqual({ kind: "none" });
    expect(deps.source.read).not.toHaveBeenCalled();
  });

  it("drops the share on Cancel, and then reads one that arrived unseen meanwhile", async () => {
    const { lib, deps, wrapper } = setUp([image(A)]);
    const { result } = await renderHook(() => useShare(), { wrapper });
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    await act(async () => {
      result.current.cancel();
    });
    await settle();
    expect(result.current.state).toEqual({ kind: "none" });
    expect(deps.source.clear).toHaveBeenCalledTimes(1);

    lib.shared = [image(A)];
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    lib.shared = [image(B)];
    await act(async () => {
      result.current.cancel();
    });
    await settle();
    expect(result.current.state).toMatchObject({ kind: "ready", photos: [copyOf(B)] });
  });

  it("hands the photos of a choice to the screen that asks for them, once", async () => {
    const { wrapper } = setUp([image(A)]);
    const { result } = await renderHook(() => useShare(), { wrapper });
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    let chosen: string | undefined;
    await act(async () => {
      chosen = await result.current.choose({ kind: "new" });
    });
    expect(chosen).toBe("open");
    expect(result.current.state).toEqual({ kind: "none" });
    expect(result.current.takeHandOff({ kind: "new" })).toEqual({
      photos: [copyOf(A).replace("/expo-sharing/", "/SharedPhotos/")],
      refused: 0,
    });
    expect(result.current.takeHandOff({ kind: "new" })).toBeNull();
  });

  it("gives the photos to a screen that made itself known and holds the find's open batch", async () => {
    const { wrapper } = setUp([image(A)]);
    const { result } = await renderHook(() => useShare(), { wrapper });
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    const join = jest.fn();
    const unregister = result.current.register({ canJoin: (id) => id === 7, join });
    let chosen: string | undefined;
    await act(async () => {
      chosen = await result.current.choose({ kind: "add", findId: 7 });
    });
    expect(chosen).toBe("joined");
    expect(join).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("keeps its functions the same while the share changes, so that a screen's effects do not run again", async () => {
    const { lib, wrapper, addressArrives } = setUp();
    const { result } = await renderHook(() => useShare(), { wrapper });
    await settle();
    const { refresh, cancel, choose, takeHandOff, register } = result.current;
    lib.shared = [image(A)];
    await addressArrives(SHARE_ADDRESS);
    expect(result.current.state.kind).toBe("ready");
    expect(result.current.refresh).toBe(refresh);
    expect(result.current.cancel).toBe(cancel);
    expect(result.current.choose).toBe(choose);
    expect(result.current.takeHandOff).toBe(takeHandOff);
    expect(result.current.register).toBe(register);
  });

  it("stops listening when it is gone", async () => {
    const { listeners, removed, wrapper } = setUp();
    const { unmount } = await renderHook(() => useShare(), { wrapper });
    await settle();
    expect(listeners).toHaveLength(1);
    await unmount();
    expect(removed()).toBe(1);
  });

  it("uses the phone's library by default, and holds no share when that gives none", async () => {
    const { result } = await renderHook(() => useShare(), {
      wrapper: ({ children }: { children: ReactNode }) => <ShareProvider>{children}</ShareProvider>,
    });
    await act(async () => {
      result.current.refresh();
    });
    await settle();
    expect(result.current.state).toEqual({ kind: "none" });
  });
});

describe("useShare", () => {
  it("throws outside a ShareProvider", async () => {
    function Outside() {
      useShare();
      return null;
    }
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(render(<Outside />)).rejects.toThrow(
        "useShare must be used inside a ShareProvider",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
